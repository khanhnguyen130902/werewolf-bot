import { GameService } from '../../src/engine/GameService';
import { RoomService } from '../../src/engine/RoomService';
import { NightActionService } from '../../src/engine/NightActionService';
import { DayService } from '../../src/engine/DayService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, RoleId } from '../../src/engine/domain/enums';
import {
  DeadPlayerActionError,
  InvalidPhaseActionError,
  DuplicateActionError,
  InvalidTargetError,
} from '../../src/engine/errors/DomainError';

class FakeClock implements ClockPort {
  private t = 1000;
  now(): number {
    return this.t;
  }
}

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
  const dayService = new DayService(storage, clock, eventBus, stateMachine);

  return {
    storage,
    clock,
    roomService,
    gameService,
    nightActionService,
    dayService,
    eventBus,
  };
}

async function createStartAndAdvanceToDay(
  roomService: RoomService,
  gameService: GameService,
  nightActionService: NightActionService,
  playerCount = 6,
) {
  await roomService.createRoom({
    roomId: 'room1',
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: 'chat1',
    settingsOverride: { minPlayers: 6, maxPlayers: 20 },
  });
  for (let i = 1; i < 7; i++) {
    await roomService.joinRoom({ roomId: 'room1', telegramId: `p${i}`, nickname: `P${i}` });
  }
  await gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' });

  const { room } = await nightActionService.resolveNight({
    roomId: 'room1',
    getHunterDecision: () => null,
  });
  return room;
}

describe('DayService phase transitions', () => {
  it('advances DAY -> DISCUSSION -> VOTING', async () => {
    const { roomService, gameService, nightActionService, dayService } = setup();
    await createStartAndAdvanceToDay(roomService, gameService, nightActionService);

    const afterDiscussion = await dayService.startDiscussion('room1');
    expect(afterDiscussion.gameState).toBe(GameState.DISCUSSION);

    const afterVoting = await dayService.startVoting('room1');
    expect(afterVoting.gameState).toBe(GameState.VOTING);
  });

  it('rejects starting discussion when not in DAY', async () => {
    const { roomService, gameService, nightActionService, dayService } = setup();
    await createStartAndAdvanceToDay(roomService, gameService, nightActionService);
    await dayService.startDiscussion('room1');
    await expect(dayService.startDiscussion('room1')).rejects.toBeInstanceOf(
      InvalidPhaseActionError,
    );
  });
});

describe('DayService.submitVote', () => {
  async function toVoting(deps: ReturnType<typeof setup>) {
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    return room;
  }

  it('accepts a valid vote from a living player', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2] = Object.keys(room.players);

    const updated = await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'vote-1',
      voterTelegramId: p1,
      targetTelegramId: p2,
    });
    expect(updated.players[p1].voteTarget).toBe(p2);
  });

  it('allows an explicit abstain (null target)', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1] = Object.keys(room.players);

    const updated = await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'vote-abstain',
      voterTelegramId: p1,
      targetTelegramId: null,
    });
    expect(updated.players[p1].voteTarget).toBeNull();
  });

  it('rejects a vote from a dead player', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2] = Object.keys(room.players);

    const current = await deps.storage.getRoom('room1');
    current!.players[p1].alive = false;
    await deps.storage.saveRoom(current!, current!.version);

    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'vote-dead',
        voterTelegramId: p1,
        targetTelegramId: p2,
      }),
    ).rejects.toBeInstanceOf(DeadPlayerActionError);
  });

  it('rejects a vote submitted outside VOTING phase', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const [p1, p2] = Object.keys(room.players);
    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'vote-early',
        voterTelegramId: p1,
        targetTelegramId: p2,
      }),
    ).rejects.toBeInstanceOf(InvalidPhaseActionError);
  });

  it('rejects voting for a dead target', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2] = Object.keys(room.players);

    const current = await deps.storage.getRoom('room1');
    current!.players[p2].alive = false;
    await deps.storage.saveRoom(current!, current!.version);

    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'vote-dead-target',
        voterTelegramId: p1,
        targetTelegramId: p2,
      }),
    ).rejects.toBeInstanceOf(InvalidTargetError);
  });

  it('rejects a duplicate actionId (idempotency guard)', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2] = Object.keys(room.players);

    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'dup-vote',
      voterTelegramId: p1,
      targetTelegramId: p2,
    });
    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'dup-vote',
        voterTelegramId: p1,
        targetTelegramId: p2,
      }),
    ).rejects.toBeInstanceOf(DuplicateActionError);
  });

  it('rejects a second vote from the same player in the same round', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2, p3] = Object.keys(room.players);

    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'vote-first',
      voterTelegramId: p1,
      targetTelegramId: p2,
    });

    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'vote-changed',
        voterTelegramId: p1,
        targetTelegramId: p3,
      }),
    ).rejects.toBeInstanceOf(DuplicateActionError);
  });

  it('rejects a second vote after an explicit abstain in the same round', async () => {
    const deps = setup();
    const room = await toVoting(deps);
    const [p1, p2] = Object.keys(room.players);

    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'vote-abstain',
      voterTelegramId: p1,
      targetTelegramId: null,
    });

    await expect(
      deps.dayService.submitVote({
        roomId: 'room1',
        actionId: 'vote-second',
        voterTelegramId: p1,
        targetTelegramId: p2,
      }),
    ).rejects.toBeInstanceOf(DuplicateActionError);
  });
});

describe('DayService.resolveExecution', () => {
  it('executes the majority-voted player and advances to NIGHT for next round', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const ids = Object.keys(room.players);
    const [voter1, voter2, voter3, target] = ids;

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'v1',
      voterTelegramId: voter1,
      targetTelegramId: target,
    });
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'v2',
      voterTelegramId: voter2,
      targetTelegramId: target,
    });
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'v3',
      voterTelegramId: voter3,
      targetTelegramId: target,
    });

    const { room: resolvedRoom, executedTelegramId } = await deps.dayService.resolveExecution({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(executedTelegramId).toBe(target);
    expect(resolvedRoom.players[target].alive).toBe(false);
    expect(resolvedRoom.gameState).toBe(GameState.NIGHT);
    expect(resolvedRoom.currentRound).toBe(2);
  });

  it('CONFIRMED RULE: a tied vote results in no execution', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const ids = Object.keys(room.players);
    const [voter1, voter2, targetA, targetB] = ids;

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'tv1',
      voterTelegramId: voter1,
      targetTelegramId: targetA,
    });
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'tv2',
      voterTelegramId: voter2,
      targetTelegramId: targetB,
    });

    const { room: resolvedRoom, executedTelegramId } = await deps.dayService.resolveExecution({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(executedTelegramId).toBeNull();
    expect(resolvedRoom.players[targetA].alive).toBe(true);
    expect(resolvedRoom.players[targetB].alive).toBe(true);
    expect(resolvedRoom.gameState).toBe(GameState.NIGHT);
  });

  it('triggers Hunter revenge shot when the executed player is a Hunter', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const hunter = Object.values(room.players).find((p) => p.role === RoleId.HUNTER)!;
    const otherPlayers = Object.values(room.players).filter(
      (p) => p.telegramId !== hunter.telegramId,
    );
    const villagerVictim = otherPlayers.find((p) => p.role === RoleId.VILLAGER)!;

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    let i = 0;
    for (const voter of otherPlayers) {
      await deps.dayService.submitVote({
        roomId: 'room1',
        actionId: `hv-${i++}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: hunter.telegramId,
      });
    }

    const { room: resolvedRoom, executedTelegramId, deaths } = await deps.dayService.resolveExecution({
      roomId: 'room1',
      getHunterDecision: (id) =>
        id === hunter.telegramId ? { targetTelegramId: villagerVictim.telegramId } : null,
    });

    expect(executedTelegramId).toBe(hunter.telegramId);
    expect(deaths).toEqual([
      { telegramId: hunter.telegramId, cause: 'VOTE_EXECUTION' },
      { telegramId: villagerVictim.telegramId, cause: 'HUNTER_SHOT' },
    ]);
    expect(resolvedRoom.players[villagerVictim.telegramId].alive).toBe(false);
  });

  it('resets everyone vote after execution for the next round', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const ids = Object.keys(room.players);
    const [voter1, voter2, target] = ids;

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'rv1',
      voterTelegramId: voter1,
      targetTelegramId: target,
    });
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'rv2',
      voterTelegramId: voter2,
      targetTelegramId: target,
    });

    const { room: resolvedRoom } = await deps.dayService.resolveExecution({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    for (const player of Object.values(resolvedRoom.players)) {
      expect(player.voteTarget).toBeNull();
    }
  });

  it('ends the game (GAME_OVER) if the execution decides the match', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const wolf = Object.values(room.players).find((p) => p.role === RoleId.WEREWOLF)!;
    const current = await deps.storage.getRoom('room1');
    const villager = Object.values(current!.players).find(
      (p) => p.role === RoleId.VILLAGER,
    )!;
    for (const p of Object.values(current!.players)) {
      if (p.telegramId !== wolf.telegramId && p.telegramId !== villager.telegramId) {
        p.alive = false;
      }
    }
    current!.gameState = GameState.DAY;
    await deps.storage.saveRoom(current!, current!.version);

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    await deps.dayService.submitVote({
      roomId: 'room1',
      actionId: 'decisive-vote',
      voterTelegramId: villager.telegramId,
      targetTelegramId: wolf.telegramId,
    });

    const { room: resolvedRoom, executedTelegramId } = await deps.dayService.resolveExecution({
      roomId: 'room1',
      getHunterDecision: () => null,
    });

    expect(executedTelegramId).toBe(wolf.telegramId);
    expect(resolvedRoom.gameState).toBe(GameState.GAME_OVER);
  });

  it('rejects resolveExecution when not in VOTING phase', async () => {
    const deps = setup();
    await createStartAndAdvanceToDay(deps.roomService, deps.gameService, deps.nightActionService);
    await expect(
      deps.dayService.resolveExecution({ roomId: 'room1', getHunterDecision: () => null }),
    ).rejects.toBeInstanceOf(InvalidPhaseActionError);
  });
});

describe('DayService split API (prepareExecutionResolution / finalizeExecutionResolution)', () => {
  it('prepareExecutionResolution identifies a pending Hunter without mutating room state', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const hunter = Object.values(room.players).find((p) => p.role === RoleId.HUNTER)!;
    const otherPlayers = Object.values(room.players).filter(
      (p) => p.telegramId !== hunter.telegramId,
    );

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    let i = 0;
    for (const voter of otherPlayers) {
      await deps.dayService.submitVote({
        roomId: 'room1',
        actionId: `prep-hv-${i++}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: hunter.telegramId,
      });
    }

    const prepared = await deps.dayService.prepareExecutionResolution('room1');

    expect(prepared.executedTelegramId).toBe(hunter.telegramId);
    expect(prepared.pendingHunterTelegramIds).toEqual([hunter.telegramId]);

    // Room state must remain unmutated -- hunter still alive, still in VOTING.
    const stillVoting = await deps.storage.getRoom('room1');
    expect(stillVoting!.players[hunter.telegramId].alive).toBe(true);
    expect(stillVoting!.gameState).toBe(GameState.VOTING);
  });

  it('finalizeExecutionResolution applies an awaited Hunter decision and advances to NIGHT', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const hunter = Object.values(room.players).find((p) => p.role === RoleId.HUNTER)!;
    const otherPlayers = Object.values(room.players).filter(
      (p) => p.telegramId !== hunter.telegramId,
    );
    const villagerVictim = otherPlayers.find((p) => p.role === RoleId.VILLAGER)!;

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    let i = 0;
    for (const voter of otherPlayers) {
      await deps.dayService.submitVote({
        roomId: 'room1',
        actionId: `fin-hv-${i++}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: hunter.telegramId,
      });
    }

    const prepared = await deps.dayService.prepareExecutionResolution('room1');

    // Simulate a REAL async await for the Hunter's Telegram response.
    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of prepared.pendingHunterTelegramIds) {
      const decision = await new Promise<{ targetTelegramId: string | null }>((resolve) => {
        setTimeout(() => resolve({ targetTelegramId: villagerVictim.telegramId }), 5);
      });
      hunterDecisions[hunterId] = decision;
    }

    const { room: finalRoom, deaths } = await deps.dayService.finalizeExecutionResolution({
      roomId: 'room1',
      executedTelegramId: prepared.executedTelegramId,
      voteCounts: prepared.voteCounts,
      depth0Deaths: prepared.depth0Deaths,
      hunterDecisions,
    });

    expect(deaths).toEqual([
      { telegramId: hunter.telegramId, cause: 'VOTE_EXECUTION' },
      { telegramId: villagerVictim.telegramId, cause: 'HUNTER_SHOT' },
    ]);
    expect(finalRoom.gameState).toBe(GameState.NIGHT);
    expect(finalRoom.currentRound).toBe(2);
  });

  it('finalizeExecutionResolution with no pending Hunters resolves correctly with an empty decisions map', async () => {
    const deps = setup();
    const room = await createStartAndAdvanceToDay(
      deps.roomService,
      deps.gameService,
      deps.nightActionService,
    );
    const target = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;
    const voters = Object.values(room.players)
      .filter((p) => p.telegramId !== target.telegramId)
      .slice(0, 3);

    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    for (const [idx, voter] of voters.entries()) {
      await deps.dayService.submitVote({
        roomId: 'room1',
        actionId: `simple-${idx}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: target.telegramId,
      });
    }

    const prepared = await deps.dayService.prepareExecutionResolution('room1');
    expect(prepared.pendingHunterTelegramIds).toEqual([]);

    const { deaths } = await deps.dayService.finalizeExecutionResolution({
      roomId: 'room1',
      executedTelegramId: prepared.executedTelegramId,
      voteCounts: prepared.voteCounts,
      depth0Deaths: prepared.depth0Deaths,
      hunterDecisions: {},
    });

    expect(deaths).toEqual([{ telegramId: target.telegramId, cause: 'VOTE_EXECUTION' }]);
  });
});
