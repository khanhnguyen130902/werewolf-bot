import { GameOrchestrator, HunterPromptFn } from '../../src/engine/GameOrchestrator';
import { RoomService } from '../../src/engine/RoomService';
import { GameService } from '../../src/engine/GameService';
import { NightActionService } from '../../src/engine/NightActionService';
import { DayService } from '../../src/engine/DayService';
import { RoomTimerService, TimerJobType } from '../../src/engine/RoomTimerService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { SchedulerPort, ScheduledJobHandle } from '../../src/engine/ports/SchedulerPort';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, RoleId, NightActionType } from '../../src/engine/domain/enums';

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

class FakeScheduler implements SchedulerPort {
  public scheduled: Array<{ jobType: string; roomId: string; delayMs: number }> = [];
  public cancelled: string[] = [];
  private nextId = 1;
  async scheduleOnce(params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle> {
    const jobId = `job-${this.nextId++}`;
    this.scheduled.push({
      jobType: params.jobType,
      roomId: params.roomId,
      delayMs: params.delayMs,
    });
    return { jobId };
  }
  async cancel(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
  }
  onJobDue(): void {
    // not exercised in these tests
  }
  async shutdown(): Promise<void> {}
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const random = new DeterministicRandom();
  const eventBus = new EventBus();
  const scheduler = new FakeScheduler();
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
  const timerService = new RoomTimerService(scheduler, storage, clock);

  const orchestrator = new GameOrchestrator(
    roomService,
    gameService,
    nightActionService,
    dayService,
    timerService,
  );

  return {
    storage,
    roomService,
    gameService,
    nightActionService,
    dayService,
    scheduler,
    orchestrator,
  };
}

async function createAndStartGame(deps: ReturnType<typeof setup>) {
  await deps.roomService.createRoom({
    roomId: 'room1',
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: 'chat1',
    settingsOverride: { minPlayers: 6, maxPlayers: 20 },
  });
  for (let i = 1; i < 6; i++) {
    await deps.roomService.joinRoom({ roomId: 'room1', telegramId: `p${i}`, nickname: `P${i}` });
  }
  return deps.gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' });
}

describe('GameOrchestrator.resolveNight', () => {
  it('awaits a REAL asynchronous Hunter prompt (genuine Promise + delay, not a stub) before finalizing', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const wolf = Object.values(room.players).find((p) => p.role === RoleId.WEREWOLF)!;
    const hunter = Object.values(room.players).find((p) => p.role === RoleId.HUNTER)!;
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await deps.nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kill-hunter',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: hunter.telegramId,
    });

    let promptWasAwaited = false;
    const promptHunter: HunterPromptFn = async (roomId, hunterTelegramId) => {
      expect(roomId).toBe('room1');
      expect(hunterTelegramId).toBe(hunter.telegramId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      promptWasAwaited = true;
      return { targetTelegramId: villager.telegramId };
    };

    const { room: finalRoom, deaths } = await deps.orchestrator.resolveNight({
      roomId: 'room1',
      promptHunter,
    });

    expect(promptWasAwaited).toBe(true);
    expect(deaths).toEqual([
      { telegramId: hunter.telegramId, cause: 'WEREWOLF_KILL' },
      { telegramId: villager.telegramId, cause: 'HUNTER_SHOT' },
    ]);
    expect(finalRoom.gameState).toBe(GameState.DAY);
  });

  it('does not call promptHunter at all when no Hunter died this night', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const wolf = Object.values(room.players).find((p) => p.role === RoleId.WEREWOLF)!;
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    await deps.nightActionService.submitNightAction({
      roomId: 'room1',
      actionId: 'wolf-kill-villager',
      actorTelegramId: wolf.telegramId,
      actionType: NightActionType.WEREWOLF_VOTE_KILL,
      targetTelegramId: villager.telegramId,
    });

    let promptCalled = false;
    const promptHunter: HunterPromptFn = async () => {
      promptCalled = true;
      return { targetTelegramId: null };
    };

    await deps.orchestrator.resolveNight({ roomId: 'room1', promptHunter });
    expect(promptCalled).toBe(false);
  });
});

describe('GameOrchestrator.resolveExecution', () => {
  it('awaits a REAL asynchronous Hunter prompt when the executed player is a Hunter', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const hunter = Object.values(room.players).find((p) => p.role === RoleId.HUNTER)!;
    const otherPlayers = Object.values(room.players).filter(
      (p) => p.telegramId !== hunter.telegramId,
    );
    const villagerVictim = otherPlayers.find((p) => p.role === RoleId.VILLAGER)!;

    await deps.nightActionService.resolveNight({
      roomId: 'room1',
      getHunterDecision: () => null,
    });
    await deps.dayService.startDiscussion('room1');
    await deps.dayService.startVoting('room1');
    let i = 0;
    for (const voter of otherPlayers) {
      await deps.dayService.submitVote({
        roomId: 'room1',
        actionId: `v-${i++}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: hunter.telegramId,
      });
    }

    let promptWasAwaited = false;
    const promptHunter: HunterPromptFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      promptWasAwaited = true;
      return { targetTelegramId: villagerVictim.telegramId };
    };

    const { deaths } = await deps.orchestrator.resolveExecution({
      roomId: 'room1',
      promptHunter,
    });

    expect(promptWasAwaited).toBe(true);
    expect(deaths).toEqual([
      { telegramId: hunter.telegramId, cause: 'VOTE_EXECUTION' },
      { telegramId: villagerVictim.telegramId, cause: 'HUNTER_SHOT' },
    ]);
  });
});

describe('GameOrchestrator timer coordination', () => {
  it('scheduleCurrentPhaseTimer schedules a NIGHT_ACTION_TIMEOUT during FIRST_NIGHT', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    expect(room.gameState).toBe(GameState.FIRST_NIGHT);

    const jobId = await deps.orchestrator.scheduleCurrentPhaseTimer(room);
    expect(jobId).not.toBeNull();
    expect(deps.scheduler.scheduled).toEqual([
      {
        jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
        roomId: 'room1',
        delayMs: room.settings.timers.nightActionSeconds * 1000,
      },
    ]);
  });

  it('scheduleCurrentPhaseTimer returns null for phases with no timer', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const waitingRoom = { ...room, gameState: GameState.WAITING };
    const jobId = await deps.orchestrator.scheduleCurrentPhaseTimer(waitingRoom);
    expect(jobId).toBeNull();
  });

  it('cancelCurrentPhaseTimer cancels an active timer', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const jobId = await deps.orchestrator.scheduleCurrentPhaseTimer(room);
    await deps.orchestrator.cancelCurrentPhaseTimer('room1', jobId);
    expect(deps.scheduler.cancelled).toEqual([jobId]);
  });

  it('cancelCurrentPhaseTimer is a no-op when jobId is null', async () => {
    const deps = setup();
    await deps.orchestrator.cancelCurrentPhaseTimer('room1', null);
    expect(deps.scheduler.cancelled).toEqual([]);
  });
});

describe('GameOrchestrator.allNightActionsSubmitted', () => {
  it('returns false when not everyone with a night action has submitted', async () => {
    const deps = setup();
    await createAndStartGame(deps);
    expect(await deps.orchestrator.allNightActionsSubmitted('room1')).toBe(false);
  });

  it('returns true once every alive player with a night action has submitted', async () => {
    const deps = setup();
    const room = await createAndStartGame(deps);
    const rolesWithAction = Object.values(room.players).filter((p) =>
      ['WEREWOLF', 'SEER', 'BODYGUARD', 'HUNTER'].includes(p.role ?? ''),
    );
    const villager = Object.values(room.players).find((p) => p.role === RoleId.VILLAGER)!;

    for (const [idx, player] of rolesWithAction.entries()) {
      const actionType =
        player.role === RoleId.WEREWOLF
          ? NightActionType.WEREWOLF_VOTE_KILL
          : player.role === RoleId.SEER
            ? NightActionType.SEER_INSPECT
            : player.role === RoleId.BODYGUARD
              ? NightActionType.BODYGUARD_PROTECT
              : NightActionType.HUNTER_SHOOT;
      await deps.nightActionService.submitNightAction({
        roomId: 'room1',
        actionId: `sub-${idx}`,
        actorTelegramId: player.telegramId,
        actionType,
        targetTelegramId:
          player.role === RoleId.WEREWOLF || player.role === RoleId.HUNTER
            ? villager.telegramId
            : null,
      });
    }

    expect(await deps.orchestrator.allNightActionsSubmitted('room1')).toBe(true);
  });
});
