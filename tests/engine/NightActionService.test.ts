import { GameService } from '../../src/engine/GameService';
import { RoomService } from '../../src/engine/RoomService';
import { NightActionService } from '../../src/engine/NightActionService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, NightActionType, RoleId } from '../../src/engine/domain/enums';
import {
  DeadPlayerActionError,
  InvalidPhaseActionError,
  WrongRoleForActionError,
  DuplicateActionError,
} from '../../src/engine/errors/DomainError';

class FakeClock implements ClockPort {
  private t = 1000;
  now(): number {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** Deterministic random: identity shuffle, always picks first candidate. */
class DeterministicRandom implements RandomPort {
  next(): number {
    return 0;
  }
  shuffle<T>(items: T[]): T[] {
    return [...items];
  }
  pick<T>(items: T[]): T {
    return items[0];
  }
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const random = new DeterministicRandom();
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
  const nightActionService = new NightActionService(
    storage,
    clock,
    random,
    eventBus,
    roleRegistry,
    stateMachine,
  );
  return { storage, clock, roomService, gameService, nightActionService, eventBus };
}

/**
 * Creates a 6-player room with identity role assignment (since
 * DeterministicRandom's shuffle is identity and RoleAssigner builds a role
 * pool then shuffles both players and roles): with 6 players and default
 * settings (1 wolf + 4 specials + 1 villager... wait, 6 players: floor(6/4)=1
 * wolf, all 4 specials enabled = 5 slots + 1 villager = 6). We verify actual
 * assignment from the returned room rather than hard-assuming positions,
 * since exact mapping depends on RoleAssigner's pool-building order.
 */
async function createAndStartGame(
  roomService: RoomService,
  gameService: GameService,
) {
  await roomService.createRoom({
    roomId: 'room1',
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: 'chat1',
    settingsOverride: { minPlayers: 6, maxPlayers: 20 },
  });
  for (let i = 1; i < 6; i++) {
    await roomService.joinRoom({ roomId: 'room1', telegramId: `p${i}`, nickname: `P${i}` });
  }
  const room = await gameService.startGame({
    roomId: 'room1',
    requestedByTelegramId: 'p0',
  });
  return room;
}

function findByRole(room: Awaited<ReturnType<typeof createAndStartGame>>, role: RoleId) {
  return Object.values(room.players).find((p) => p.role === role)!;
}

describe('NightActionService.submitNightAction', () => {
  it('accepts a valid werewolf submission', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    const updated = await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'action-1',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    expect(updated.pendingNightActions).toHaveLength(1);
    expect(updated.pendingNightActions[0].actorTelegramId).toBe(wolf.telegramId);
  });

  it('rejects action from a dead player', async () => {
    const { roomService, gameService, nightActionService, storage } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);

    // Kill the wolf out of band to simulate a dead player trying to act.
    const current = await storage.getRoom('room1');
    current!.players[wolf.telegramId].alive = false;
    await storage.saveRoom(current!, current!.version);

    await expect(
      nightActionService.submitNightAction({
        roomId: 'room1',
        actionId: 'action-x',
        actorTelegramId: wolf.telegramId,
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: 'p1',
      }),
    ).rejects.toBeInstanceOf(DeadPlayerActionError);
  });

  it('rejects action submitted outside NIGHT/FIRST_NIGHT phase', async () => {
    const { roomService, gameService, nightActionService, storage } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);

    const current = await storage.getRoom('room1');
    current!.gameState = GameState.DAY;
    await storage.saveRoom(current!, current!.version);

    await expect(
      nightActionService.submitNightAction({
        roomId: 'room1',
        actionId: 'action-y',
        actorTelegramId: wolf.telegramId,
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: 'p1',
      }),
    ).rejects.toBeInstanceOf(InvalidPhaseActionError);
  });

  it('rejects a player submitting an action for a role they do not have', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await expect(
      nightActionService.submitNightAction({
        roomId: 'room1',
        actionId: 'action-z',
        actorTelegramId: villager.telegramId,
        actionType: NightActionType.WEREWOLF_VOTE_KILL, // villager spoofing wolf action
        targetTelegramId: 'p1',
      }),
    ).rejects.toBeInstanceOf(WrongRoleForActionError);
  });

  it('rejects a duplicate actionId (idempotency guard)', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'dup-1',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    await expect(
      nightActionService.submitNightAction({
        roomId: 'room1',
        actionId: 'dup-1', // same actionId submitted again
        actorTelegramId: wolf.telegramId,
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: villager.telegramId,
      }),
    ).rejects.toBeInstanceOf(DuplicateActionError);
  });

  it('allows a werewolf to update their kill target in the same round', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const nonWerewolfTargets = Object.values(room.players).filter(
      (p) => p.telegramId !== wolf.telegramId && p.role !== RoleId.WEREWOLF,
    );

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'first-choice',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: nonWerewolfTargets[0].telegramId,
    });

    const updatedRoom = await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'changed-mind',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: nonWerewolfTargets[1].telegramId,
    });

    const werewolfAction = updatedRoom.pendingNightActions.find(
      (action) =>
        action.actorTelegramId === wolf.telegramId &&
        action.actionType === NightActionType.WEREWOLF_VOTE_KILL,
    );

    expect(werewolfAction?.targetTelegramId).toBe(nonWerewolfTargets[1].telegramId);
  });

  it('allows a Witch to submit both save and poison in the same round', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const witch = findByRole(room, RoleId.WITCH);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    const first = await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'witch-save',
      actorTelegramId: witch.telegramId,
      actionType: NightActionType.WITCH_SAVE,
      targetTelegramId: witch.telegramId,
    });

    const second = await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'witch-poison',
      actorTelegramId: witch.telegramId,
      actionType: NightActionType.WITCH_POISON,
      targetTelegramId: villager.telegramId,
    });

    expect(first.pendingNightActions).toHaveLength(1);
    expect(second.pendingNightActions).toHaveLength(2);
  });
});

describe('NightActionService.resolveNight', () => {
  it('resolves a night with a werewolf kill and transitions to DAY', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'k1',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    const { room: resolvedRoom, deaths } = await nightActionService.resolveNight({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(deaths).toEqual([{ telegramId: villager.telegramId, cause: 'WEREWOLF_KILL' }]);
    expect(resolvedRoom.gameState).toBe(GameState.DAY);
    expect(resolvedRoom.players[villager.telegramId].alive).toBe(false);
    expect(resolvedRoom.pendingNightActions).toEqual([]);
  });

  it('ends the game immediately (DAY->CHECK_WIN->GAME_OVER) if night resolution meets win condition', async () => {
    const { roomService, gameService, nightActionService, storage } = setup();
    const room = await createAndStartGame(roomService, gameService);

    // Force a near-win state: only 1 werewolf and 1 villager alive so
    // killing the villager makes the werewolf reach parity/majority.
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const current = await storage.getRoom('room1');
    const allIds = Object.keys(current!.players);
    for (const id of allIds) {
      if (id !== wolf.telegramId) {
        // Keep exactly one non-wolf alive; kill the rest so parity is
        // reached the instant that one dies.
      }
    }
    // Simplest approach: mark everyone except the wolf and one villager as
    // already dead before this final night.
    const villager = Object.values(current!.players).find(
      (p) => p.role === RoleId.VILLAGER,
    )!;
    for (const p of Object.values(current!.players)) {
      if (p.telegramId !== wolf.telegramId && p.telegramId !== villager.telegramId) {
        p.alive = false;
      }
    }
    await storage.saveRoom(current!, current!.version);

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'final-kill',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    const { room: resolvedRoom } = await nightActionService.resolveNight({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(resolvedRoom.gameState).toBe(GameState.GAME_OVER);
  });

  it('delivers Seer result even when Seer dies the same night (confirmed rule)', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const seer = findByRole(room, RoleId.SEER);
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kills-seer',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: seer.telegramId,
    });
    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'seer-inspects',
      actorTelegramId: seer.telegramId,
      actionType: NightActionType.SEER_INSPECT,
      targetTelegramId: villager.telegramId,
    });

    const { room: resolvedRoom, seerResults } = await nightActionService.resolveNight({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(resolvedRoom.players[seer.telegramId].alive).toBe(false);
    expect(seerResults).toHaveLength(1);
    expect(seerResults[0].seerTelegramId).toBe(seer.telegramId);
  });
});

describe('NightActionService split API (prepareNightResolution / finalizeNightResolution)', () => {
  it('prepareNightResolution identifies a pending Hunter without mutating room state', async () => {
    const { roomService, gameService, nightActionService, storage } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const hunter = findByRole(room, RoleId.HUNTER);

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kills-hunter',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: hunter.telegramId,
    });

    const { stepOneResult } = await nightActionService.prepareNightResolution('room1');

    expect(stepOneResult.pendingHunterTelegramIds).toEqual([hunter.telegramId]);
    // Room state must remain unmutated at this point -- hunter still alive,
    // pendingNightActions still populated (not cleared until finalize).
    const stillPending = await storage.getRoom('room1');
    expect(stillPending!.players[hunter.telegramId].alive).toBe(true);
    expect(stillPending!.pendingNightActions.length).toBeGreaterThan(0);
  });

  it('finalizeNightResolution applies an awaited Hunter decision and transitions to DAY', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const hunter = findByRole(room, RoleId.HUNTER);
    const villager = Object.values(room.players).find(
      (p) => p.role === RoleId.VILLAGER,
    )!;

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kills-hunter-2',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: hunter.telegramId,
    });

    const { stepOneResult } = await nightActionService.prepareNightResolution('room1');

    // Simulate a REAL async await for the Hunter's Telegram response.
    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of stepOneResult.pendingHunterTelegramIds) {
      const decision = await new Promise<{ targetTelegramId: string | null }>((resolve) => {
        setTimeout(() => resolve({ targetTelegramId: villager.telegramId }), 5);
      });
      hunterDecisions[hunterId] = decision;
    }

    const { room: finalRoom, deaths } = await nightActionService.finalizeNightResolution({
      roomId: 'room1',
      stepOneResult,
      hunterDecisions,
    });

    expect(deaths).toEqual([
      { telegramId: hunter.telegramId, cause: 'WEREWOLF_KILL' },
      { telegramId: villager.telegramId, cause: 'HUNTER_SHOT' },
    ]);
    expect(finalRoom.gameState).toBe(GameState.DAY);
    expect(finalRoom.pendingNightActions).toEqual([]);
  });

  it('finalizeNightResolution with no pending Hunters requires no decisions and still resolves correctly', async () => {
    const { roomService, gameService, nightActionService } = setup();
    const room = await createAndStartGame(roomService, gameService);
    const wolf = findByRole(room, RoleId.WEREWOLF);
    const villager = Object.values(room.players).find(
      (p) => p.role === RoleId.VILLAGER,
    )!;

    await nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kills-villager',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    const { stepOneResult } = await nightActionService.prepareNightResolution('room1');
    expect(stepOneResult.pendingHunterTelegramIds).toEqual([]);

    const { room: finalRoom, deaths } = await nightActionService.finalizeNightResolution({
      roomId: 'room1',
      stepOneResult,
      hunterDecisions: {},
    });

    expect(deaths).toEqual([{ telegramId: villager.telegramId, cause: 'WEREWOLF_KILL' }]);
    expect(finalRoom.gameState).toBe(GameState.DAY);
  });
});
