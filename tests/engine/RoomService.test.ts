import { RoomService } from '../../src/engine/RoomService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import {
  RoomFullError,
  RoomNotFoundError,
  PlayerAlreadyInRoomError,
  PlayerNotInRoomError,
  NotHostError,
  RoomLockedError,
} from '../../src/engine/errors/DomainError';
import { DomainEvent } from '../../src/engine/events/DomainEvent';
import { GameState, RoomStatus } from '../../src/engine/domain/enums';

class FakeClock implements ClockPort {
  constructor(private t: number = 1000) {}
  now(): number {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const eventBus = new EventBus();
  const capturedEvents: DomainEvent[] = [];
  eventBus.subscribe((e) => {
    capturedEvents.push(e);
  });
  const service = new RoomService(storage, clock, eventBus);
  return { storage, clock, eventBus, service, capturedEvents };
}

describe('RoomService', () => {
  it('creates a room with host as first player', async () => {
    const { service } = setup();
    const room = await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });

    expect(room.hostTelegramId).toBe('host1');
    expect(Object.keys(room.players)).toEqual(['host1']);
    expect(room.players['host1'].isHost).toBe(true);
    expect(room.status).toBe(RoomStatus.OPEN);
    expect(room.version).toBe(0); // saveRoom(-1) -> version becomes -1+1=0
  });

  it('emits ROOM_CREATED and PLAYER_JOINED events on create', async () => {
    const { service, capturedEvents } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    expect(capturedEvents.map((e) => e.type)).toEqual([
      'ROOM_CREATED',
      'PLAYER_JOINED',
    ]);
  });

  it('allows a player to join an open room', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    const room = await service.joinRoom({
      roomId: 'room1',
      telegramId: 'p2',
      nickname: 'Player2',
    });
    expect(Object.keys(room.players).sort()).toEqual(['host1', 'p2']);
  });

  it('rejects joining a non-existent room', async () => {
    const { service } = setup();
    await expect(
      service.joinRoom({ roomId: 'ghost', telegramId: 'p1', nickname: 'X' }),
    ).rejects.toBeInstanceOf(RoomNotFoundError);
  });

  it('rejects double-join by the same player', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await expect(
      service.joinRoom({ roomId: 'room1', telegramId: 'host1', nickname: 'Host' }),
    ).rejects.toBeInstanceOf(PlayerAlreadyInRoomError);
  });

  it('rejects joining when room is full (maxPlayers)', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
      settingsOverride: { maxPlayers: 1 },
    });
    await expect(
      service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' }),
    ).rejects.toBeInstanceOf(RoomFullError);
  });

  it('rejects joining a locked room', async () => {
    const { service, storage } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    const room = await storage.getRoom('room1');
    await storage.saveRoom({ ...room!, status: RoomStatus.LOCKED }, room!.version);

    await expect(
      service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' }),
    ).rejects.toBeInstanceOf(RoomLockedError);
  });

  it('allows a player to leave', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' });
    const room = await service.leaveRoom({ roomId: 'room1', telegramId: 'p2' });
    expect(Object.keys(room.players)).toEqual(['host1']);
  });

  it('rejects leave for a player not in the room', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await expect(
      service.leaveRoom({ roomId: 'room1', telegramId: 'ghost' }),
    ).rejects.toBeInstanceOf(PlayerNotInRoomError);
  });

  it('allows host to kick a player', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' });
    const room = await service.kickPlayer({
      roomId: 'room1',
      hostTelegramId: 'host1',
      targetTelegramId: 'p2',
    });
    expect(Object.keys(room.players)).toEqual(['host1']);
  });

  it('rejects kick from a non-host', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' });
    await expect(
      service.kickPlayer({
        roomId: 'room1',
        hostTelegramId: 'p2',
        targetTelegramId: 'host1',
      }),
    ).rejects.toBeInstanceOf(NotHostError);
  });

  it('closeRoom removes room and clears sessions', async () => {
    const { service, storage } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    await service.closeRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      reason: 'test',
    });
    expect(await storage.getRoom('room1')).toBeNull();
    expect(await storage.getPlayerSession('host1')).toBeNull();
  });

  it('allows recreating a room after a finished match with the same room id', async () => {
    const { service, storage } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    const existing = await storage.getRoom('room1');
    await storage.saveRoom(
      {
        ...existing!,
        gameState: GameState.GAME_OVER,
        status: RoomStatus.LOCKED,
      },
      existing!.version,
    );

    const recreated = await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });

    expect(recreated.id).toBe('room1');
    expect(recreated.status).toBe(RoomStatus.OPEN);
    expect(recreated.gameState).toBe(GameState.WAITING);
    expect(Object.keys(recreated.players)).toEqual(['host1']);
  });

  it('handles concurrent joins without losing an update (optimistic locking)', async () => {
    const { service } = setup();
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
      settingsOverride: { maxPlayers: 20 },
    });

    // Simulate 5 players joining "simultaneously"
    const joiners = ['p2', 'p3', 'p4', 'p5', 'p6'];
    await Promise.all(
      joiners.map((id) =>
        service.joinRoom({ roomId: 'room1', telegramId: id, nickname: id }),
      ),
    );

    const room = await service.getRoom('room1');
    expect(Object.keys(room!.players).sort()).toEqual(
      ['host1', ...joiners].sort(),
    );
  });
});

describe('RoomService DM-reachability gating (confirmed UX rule)', () => {
  function strictSetup() {
    // defaultDmReachable=false: only telegramIds explicitly marked via
    // storage.markDmReachable() will pass the check, exactly like the real
    // RedisStorageAdapter behaves for a user who has never DMed the bot.
    const storage = new InMemoryStorageAdapter(false);
    const clock = new FakeClock();
    const eventBus = new EventBus();
    const service = new RoomService(storage, clock, eventBus);
    return { storage, clock, eventBus, service };
  }

  it('rejects createRoom when the host has not DMed the bot', async () => {
    const { service } = strictSetup();
    await expect(
      service.createRoom({
        roomId: 'room1',
        hostTelegramId: 'host1',
        hostNickname: 'Host',
        chatId: 'chat1',
      }),
    ).rejects.toThrow(/has not started a DM/);
  });

  it('allows createRoom once the host has been marked DM-reachable', async () => {
    const { service, storage } = strictSetup();
    await storage.markDmReachable('host1');
    const room = await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });
    expect(room.hostTelegramId).toBe('host1');
  });

  it('rejects joinRoom when the joining player has not DMed the bot', async () => {
    const { service, storage } = strictSetup();
    await storage.markDmReachable('host1');
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });

    await expect(
      service.joinRoom({ roomId: 'room1', telegramId: 'p2', nickname: 'P2' }),
    ).rejects.toThrow(/has not started a DM/);
  });

  it('allows joinRoom once the joining player has been marked DM-reachable', async () => {
    const { service, storage } = strictSetup();
    await storage.markDmReachable('host1');
    await storage.markDmReachable('p2');
    await service.createRoom({
      roomId: 'room1',
      hostTelegramId: 'host1',
      hostNickname: 'Host',
      chatId: 'chat1',
    });

    const room = await service.joinRoom({
      roomId: 'room1',
      telegramId: 'p2',
      nickname: 'P2',
    });
    expect(Object.keys(room.players).sort()).toEqual(['host1', 'p2']);
  });
});
