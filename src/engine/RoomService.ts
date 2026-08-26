import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';
import { EventBus } from './events/EventBus';
import { DomainEventType } from './domain/enums';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { MAX_SUPPORTED_PLAYERS, RoomFactory, GameSettings, RoomState } from './domain/Room';
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
 * handlers call into - it contains NO Telegraf types, only plain strings/ids,
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

  async findActiveRoomByChatId(chatId: string): Promise<RoomState | null> {
    const roomIds = await this.storage.listActiveRoomIds();
    for (const roomId of roomIds) {
      const room = await this.storage.getRoom(roomId);
      if (room && room.chatId === chatId && room.status !== RoomStatus.CLOSED) return room;
    }
    return null;
  }

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
    hostUsername?: string | null;
    chatId: string;
    settingsOverride?: Partial<GameSettings>;
  }): Promise<RoomState> {
    const dmReachable = await this.storage.isDmReachable(params.hostTelegramId);
    if (!dmReachable) {
      throw new DmNotReachableError(params.hostTelegramId);
    }

    // A host may create a new room after a completed match whose final
    // presentation was interrupted. Reclaim only a terminal/missing session;
    // an active-room session remains protected by the cross-room invariant.
    await this.reclaimTerminalPlayerSession(params.hostTelegramId, params.roomId);

    const now = this.clock.now();
    const existingRoom = await this.storage.getRoom(params.roomId);

    if (existingRoom) {
      const canRecreate =
        existingRoom.gameState === GameState.GAME_OVER || existingRoom.status === RoomStatus.CLOSED;
      if (!canRecreate) {
        throw new RoomLockedError(params.roomId);
      }

      for (const telegramId of Object.keys(existingRoom.players)) {
        await this.storage.clearPlayerSession(telegramId, existingRoom.id);
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
      username: params.hostUsername,
      isHost: true,
      joinedAt: now,
    });

    const saved = await this.storage.saveRoom(room, -1);
    const hostClaimed = await this.storage.setPlayerSessionIfAbsent(
      params.hostTelegramId,
      params.roomId,
    );
    if (!hostClaimed) {
      const currentSession = await this.storage.getPlayerSession(params.hostTelegramId);
      if (currentSession === params.roomId) {
        // A stale session pointing at the room being recreated is safe to reuse.
        await this.storage.setPlayerSession(params.hostTelegramId, params.roomId);
      } else {
        await this.storage.deleteRoom(params.roomId);
        throw new PlayerAlreadyInRoomError(params.hostTelegramId);
      }
    }

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
            username: params.hostUsername ?? null,
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
    username?: string | null;
  }): Promise<RoomState> {
    const now = this.clock.now();

    // Resolve room existence before user-level preconditions so a /join
    // request in a group with no game always gets the correct room message.
    // Otherwise users who have not opened a DM with the bot receive
    // DmNotReachableError first, making the result appear intermittent.
    const existingRoom = await this.storage.getRoom(params.roomId);
    if (!existingRoom) {
      throw new RoomNotFoundError(params.roomId);
    }

    // DM reachability is checked before the optimistic-retry mutation because
    // it is a request precondition, not part of room-state concurrency.
    const dmReachable = await this.storage.isDmReachable(params.telegramId);
    if (!dmReachable) {
      throw new DmNotReachableError(params.telegramId);
    }

    // A completed match may still have a player-session key when the terminal
    // Telegram presentation was interrupted or the process restarted. Reclaim
    // only sessions whose referenced room is terminal/missing; an active room
    // remains protected by the cross-room session invariant.
    await this.reclaimTerminalPlayerSession(params.telegramId, params.roomId);

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (room.status !== RoomStatus.OPEN) {
        throw new RoomLockedError(room.id);
      }
      if (room.players[params.telegramId]) {
        throw new PlayerAlreadyInRoomError(params.telegramId);
      }
      const maxPlayers = Math.min(MAX_SUPPORTED_PLAYERS, room.settings.maxPlayers);
      if (Object.keys(room.players).length >= maxPlayers) {
        throw new RoomFullError(room.id, maxPlayers);
      }
      const newPlayer = PlayerFactory.create({
        telegramId: params.telegramId,
        nickname: params.nickname,
        username: params.username,
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

    const claimed = await this.storage.setPlayerSessionIfAbsent(
      params.telegramId,
      params.roomId,
    );
    if (!claimed) {
      // The room write succeeded, but the user was concurrently claimed by
      // another room. Roll back only this membership before surfacing the
      // conflict, otherwise the room would retain a player whose session points
      // elsewhere.
      await this.withRetry(params.roomId, (latest) => {
        if (!latest.players[params.telegramId]) return { room: latest, events: [] };
        const players = { ...latest.players };
        delete players[params.telegramId];
        return {
          room: { ...latest, players, updatedAt: now },
          events: [],
        };
      });
      throw new PlayerAlreadyInRoomError(params.telegramId);
    }
    await this.eventBus.publishAll(events);
    return room;
  }

  /**
   * Releases sessions for a terminal room. The room-state check makes this
   * safe to call from GAME_OVER presentation code and idempotent on retries.
   * clearPlayerSession(roomId) is guarded, so a player who already joined a
   * different room is never cleared accidentally.
   */
  async releaseTerminalPlayerSessions(roomId: string): Promise<void> {
    const room = await this.storage.getRoom(roomId);
    if (!room || (room.gameState !== GameState.GAME_OVER && room.status !== RoomStatus.CLOSED)) {
      return;
    }

    await Promise.all(
      Object.keys(room.players).map((telegramId) =>
        this.storage.clearPlayerSession(telegramId, room.id),
      ),
    );
  }

  private async reclaimTerminalPlayerSession(
    telegramId: string,
    requestedRoomId: string,
  ): Promise<void> {
    const currentRoomId = await this.storage.getPlayerSession(telegramId);
    if (!currentRoomId || currentRoomId === requestedRoomId) return;

    const currentRoom = await this.storage.getRoom(currentRoomId);
    const terminalOrMissing =
      !currentRoom
      || currentRoom.gameState === GameState.GAME_OVER
      || currentRoom.status === RoomStatus.CLOSED;
    if (terminalOrMissing) {
      await this.storage.clearPlayerSession(telegramId, currentRoomId);
    }
  }

  async leaveRoom(params: { roomId: string; telegramId: string }): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (!room.players[params.telegramId]) {
        throw new PlayerNotInRoomError(params.telegramId);
      }
      const remainingPlayers = { ...room.players };
      delete remainingPlayers[params.telegramId];
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

    await this.storage.clearPlayerSession(params.telegramId, params.roomId);
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
      const remainingPlayers = { ...room.players };
      delete remainingPlayers[params.targetTelegramId];
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

    await this.storage.clearPlayerSession(params.targetTelegramId, params.roomId);
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
      await this.storage.clearPlayerSession(telegramId, room.id);
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
