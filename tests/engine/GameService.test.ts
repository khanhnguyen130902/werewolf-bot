import { GameService } from '../../src/engine/GameService';
import { RoomService } from '../../src/engine/RoomService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, RoomStatus, RoleId } from '../../src/engine/domain/enums';
import {
  NotEnoughPlayersError,
  NotHostError,
  TooManyPlayersForRolesError,
} from '../../src/engine/errors/DomainError';

class FakeClock implements ClockPort {
  constructor(private t: number = 1000) {}
  now(): number {
    return this.t;
  }
}

class SeededRandom implements RandomPort {
  next(): number {
    return 0.42;
  }
  shuffle<T>(items: T[]): T[] {
    return [...items]; // identity shuffle for deterministic assertions
  }
  pick<T>(items: T[]): T {
    return items[0];
  }
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const random = new SeededRandom();
  const eventBus = new EventBus();
  const roleRegistry = createPhase1RoleRegistry();
  const distributionRegistry = createDefaultDistributionStrategyRegistry();
  const stateMachine = new GameStateMachine();

  const roomService = new RoomService(storage, clock, eventBus);
  const gameService = new GameService(
    storage,
    clock,
    random,
    eventBus,
    roleRegistry,
    distributionRegistry,
    stateMachine,
  );
  return { storage, clock, roomService, gameService, eventBus };
}

async function createRoomWithPlayers(
  roomService: RoomService,
  count: number,
  settingsOverride?: Record<string, unknown>,
) {
  const room = await roomService.createRoom({
    roomId: 'room1',
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: 'chat1',
    settingsOverride: { minPlayers: 6, maxPlayers: 20, enabledRoles: [], ...settingsOverride },
  });
  for (let i = 1; i < count; i++) {
    await roomService.joinRoom({
      roomId: 'room1',
      telegramId: `p${i}`,
      nickname: `Player${i}`,
    });
  }
  return room;
}

describe('GameService.startGame', () => {
  it('assigns roles to all players and transitions to FIRST_NIGHT', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6);

    const room = await gameService.startGame({
      roomId: 'room1',
      requestedByTelegramId: 'p0',
    });

    expect(room.gameState).toBe(GameState.FIRST_NIGHT);
    expect(room.status).toBe(RoomStatus.LOCKED);
    expect(room.currentRound).toBe(1);
    expect(room.matchId).not.toBeNull();

    const roles = Object.values(room.players).map((p) => p.role);
    expect(roles.every((r) => r !== null)).toBe(true);
    expect(roles.filter((r) => r === RoleId.WEREWOLF)).toHaveLength(2);
  });

  it('initializes witch potions when Witch role is in play', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6, {
      enabledRoles: ['WITCH'],
    });
    const room = await gameService.startGame({
      roomId: 'room1',
      requestedByTelegramId: 'p0',
    });
    expect(room.witchPotions).toEqual({ saveUsed: false, poisonUsed: false });
  });

  it('leaves witchPotions null when Witch role is not enabled', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6, { enabledRoles: [] });
    const room = await gameService.startGame({
      roomId: 'room1',
      requestedByTelegramId: 'p0',
    });
    expect(room.witchPotions).toBeNull();
  });

  it('rejects starting with fewer than minPlayers', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 3);
    await expect(
      gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' }),
    ).rejects.toBeInstanceOf(NotEnoughPlayersError);
  });

  it('rejects starting the game by a non-host', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6);
    await expect(
      gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p1' }),
    ).rejects.toBeInstanceOf(NotHostError);
  });

  it('rejects starting when enabled special roles do not fit player count', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6, {
      minPlayers: 4,
      enabledRoles: ['SEER', 'BODYGUARD', 'HUNTER', 'WITCH'],
    });
    // Reduce to 4 players: wolves=1, specials=4 -> needs 5 slots > 4 -> should throw.
    await roomService.leaveRoom({ roomId: 'room1', telegramId: 'p5' });
    await roomService.leaveRoom({ roomId: 'room1', telegramId: 'p4' });
    await expect(
      gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' }),
    ).rejects.toBeInstanceOf(TooManyPlayersForRolesError);
  });

  it('locks the room so no further joins are possible after start', async () => {
    const { roomService, gameService } = setup();
    await createRoomWithPlayers(roomService, 6);
    await gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' });
    await expect(
      roomService.joinRoom({ roomId: 'room1', telegramId: 'late', nickname: 'Late' }),
    ).rejects.toThrow();
  });

  it('emits GAME_STARTED, ROLES_ASSIGNED, and two PHASE_CHANGED events', async () => {
    const { roomService, gameService, eventBus } = setup();
    await createRoomWithPlayers(roomService, 6);

    const captured: string[] = [];
    eventBus.subscribe((e) => {
      captured.push(e.type);
    });

    await gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' });

    expect(captured).toEqual([
      'GAME_STARTED',
      'ROLES_ASSIGNED',
      'PHASE_CHANGED',
      'PHASE_CHANGED',
    ]);
  });

  it('persists events retrievable via storage.getEvents(matchId)', async () => {
    const { roomService, gameService, storage } = setup();
    await createRoomWithPlayers(roomService, 6);
    const room = await gameService.startGame({
      roomId: 'room1',
      requestedByTelegramId: 'p0',
    });
    const events = await storage.getEvents(room.matchId!);
    expect(events.length).toBeGreaterThan(0);
  });
});
