import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';
import { EventBus } from './events/EventBus';
import { DomainEventType } from './domain/enums';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { RoomFactory, GameSettings, RoomState } from './domain/Room';
import { PlayerFactory } from './domain/Player';
import { GameState, RoomStatus } from './domain/enums';
import {
  RoomNotFoundError,
  RoomFullError,
  RoomLockedError,
  PlayerAlreadyInRoomError,
  PlayerNotInRoomError,
  NotHostError,
  ConcurrentModificationError,
  DmNotReachableError,
} from './errors/DomainError';

// Set high enough to absorb realistic burst contention (e.g. many players
// tapping "Join" within the same tick). Each retry is a cheap in-memory /
// Redis round trip, so a generous ceiling costs little but avoids spurious
// failures for legitimate concurrent joins.
const MAX_OPTIMISTIC_RETRY = 10;

/**
 * Application service coordinating Room lifecycle operations (create, join,
 * leave, kick). This is the primary entry point the Telegram command
 * handlers call into — it contains NO Telegraf types, only plain strings/ids,
 * keeping it reusable from any front-end.
 *
 * Concurrency strategy (Suggestion #1): every mutation is expressed as
 * read -> mutate -> saveRoom(expectedVersion). If saveRoom detects another
 * writer got there first (ConcurrentModificationError), we retry the whole
 * read-mutate-save cycle up to MAX_OPTIMISTIC_RETRY times. This avoids lost
 * updates when e.g. two players click "Join" at the same moment.
 */
export class RoomService {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
    private readonly eventBus: EventBus,
  ) {}

  private async withRetry(
    roomId: string,
    mutate: (room: RoomState) => { room: RoomState; events: DomainEvent[] },
  ): Promise<{ room: RoomState; events: DomainEvent[] }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRY; attempt++) {
      const room = await this.storage.getRoom(roomId);
      if (!room) {
        throw new RoomNotFoundError(roomId);
      }
      try {
        const { room: mutated, events } = mutate(room);
        const saved = await this.storage.saveRoom(mutated, room.version);
        return { room: saved, events };
      } catch (err) {
        if (err instanceof ConcurrentModificationError) {
          lastError = err;
          continue; // retry with fresh read
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ConcurrentModificationError(roomId);
  }

  async createRoom(params: {
    roomId: string;
    hostTelegramId: string;
    hostNickname: string;
    chatId: string;
    settingsOverride?: Partial<GameSettings>;
  }): Promise<RoomState> {
    const dmReachable = await this.storage.isDmReachable(params.hostTelegramId);
    if (!dmReachable) {
      throw new DmNotReachableError(params.hostTelegramId);
    }

    const now = this.clock.now();
    const existingRoom = await this.storage.getRoom(params.roomId);

    if (existingRoom) {
      const canRecreate =
        existingRoom.gameState === GameState.GAME_OVER || existingRoom.status === RoomStatus.CLOSED;
      if (!canRecreate) {
        throw new RoomLockedError(params.roomId);
      }

      for (const telegramId of Object.keys(existingRoom.players)) {
        await this.storage.clearPlayerSession(telegramId);
      }
      await this.storage.clearTimerDeadline(params.roomId);
      await this.storage.deleteRoom(params.roomId);
    }

    let room = RoomFactory.create({
      id: params.roomId,
      hostTelegramId: params.hostTelegramId,
      chatId: params.chatId,
      settingsOverride: params.settingsOverride,
      now,
    });
    room.players[params.hostTelegramId] = PlayerFactory.create({
      telegramId: params.hostTelegramId,
      nickname: params.hostNickname,
      isHost: true,
      joinedAt: now,
    });

    const saved = await this.storage.saveRoom(room, -1);
    await this.storage.setPlayerSession(params.hostTelegramId, params.roomId);

    const events: DomainEvent[] = [
      createEvent(
        {
          type: DomainEventType.ROOM_CREATED,
          roomId: params.roomId,
          matchId: null,
          round: 0,
          payload: { hostTelegramId: params.hostTelegramId },
        },
        now,
      ),
      createEvent(
        {
          type: DomainEventType.PLAYER_JOINED,
          roomId: params.roomId,
          matchId: null,
          round: 0,
          payload: {
            telegramId: params.hostTelegramId,
            nickname: params.hostNickname,
          },
        },
        now,
      ),
    ];
    await this.eventBus.publishAll(events);
    return saved;
  }

  async joinRoom(params: {
    roomId: string;
    telegramId: string;
    nickname: string;
  }): Promise<RoomState> {
    const now = this.clock.now();

    // Confirmed UX rule: check DM-reachability BEFORE the optimistic-retry
    // mutate closure, since it's a simple precondition read (not part of
    // the room's own concurrency-sensitive state) and failing fast here
    // avoids wasted retry attempts for a request that can never succeed.
    const dmReachable = await this.storage.isDmReachable(params.telegramId);
    if (!dmReachable) {
      throw new DmNotReachableError(params.telegramId);
    }

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (room.status !== RoomStatus.OPEN) {
        throw new RoomLockedError(room.id);
      }
      if (room.players[params.telegramId]) {
        throw new PlayerAlreadyInRoomError(params.telegramId);
      }
      if (Object.keys(room.players).length >= room.settings.maxPlayers) {
        throw new RoomFullError(room.id, room.settings.maxPlayers);
      }
      const newPlayer = PlayerFactory.create({
        telegramId: params.telegramId,
        nickname: params.nickname,
        joinedAt: now,
      });
      const updated: RoomState = {
        ...room,
        players: { ...room.players, [params.telegramId]: newPlayer },
        updatedAt: now,
      };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.PLAYER_JOINED,
            roomId: room.id,
            matchId: null,
            round: room.currentRound,
            payload: { telegramId: params.telegramId, nickname: params.nickname },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    await this.storage.setPlayerSession(params.telegramId, params.roomId);
    await this.eventBus.publishAll(events);
    return room;
  }

  async leaveRoom(params: { roomId: string; telegramId: string }): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (!room.players[params.telegramId]) {
        throw new PlayerNotInRoomError(params.telegramId);
      }
      const { [params.telegramId]: _removed, ...remainingPlayers } = room.players;
      const updated: RoomState = {
        ...room,
        players: remainingPlayers,
        updatedAt: now,
      };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.PLAYER_LEFT,
            roomId: room.id,
            matchId: null,
            round: room.currentRound,
            payload: { telegramId: params.telegramId },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    await this.storage.clearPlayerSession(params.telegramId);
    await this.eventBus.publishAll(events);
    return room;
  }

  async kickPlayer(params: {
    roomId: string;
    hostTelegramId: string;
    targetTelegramId: string;
  }): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (room.hostTelegramId !== params.hostTelegramId) {
        throw new NotHostError(params.hostTelegramId);
      }
      if (!room.players[params.targetTelegramId]) {
        throw new PlayerNotInRoomError(params.targetTelegramId);
      }
      const { [params.targetTelegramId]: _removed, ...remainingPlayers } = room.players;
      const updated: RoomState = {
        ...room,
        players: remainingPlayers,
        updatedAt: now,
      };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.PLAYER_KICKED,
            roomId: room.id,
            matchId: null,
            round: room.currentRound,
            payload: {
              telegramId: params.targetTelegramId,
              byHost: params.hostTelegramId,
            },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    await this.storage.clearPlayerSession(params.targetTelegramId);
    await this.eventBus.publishAll(events);
    return room;
  }

  async closeRoom(params: {
    roomId: string;
    hostTelegramId: string;
    reason: string;
  }): Promise<void> {
    const now = this.clock.now();
    const room = await this.storage.getRoom(params.roomId);
    if (!room) {
      throw new RoomNotFoundError(params.roomId);
    }
    if (room.hostTelegramId !== params.hostTelegramId) {
      throw new NotHostError(params.hostTelegramId);
    }
    for (const telegramId of Object.keys(room.players)) {
      await this.storage.clearPlayerSession(telegramId);
    }
    await this.storage.deleteRoom(params.roomId);
    await this.eventBus.publish(
      createEvent(
        {
          type: DomainEventType.ROOM_CLOSED,
          roomId: params.roomId,
          matchId: null,
          round: room.currentRound,
          payload: { reason: params.reason },
        },
        now,
      ),
    );
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    return this.storage.getRoom(roomId);
  }
}
