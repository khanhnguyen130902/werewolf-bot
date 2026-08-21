import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { GameState, NightActionType, NightPhase, RoleId, RoomStatus, Team } from '../../src/engine/domain/enums';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { NightActionService } from '../../src/engine/NightActionService';
import { GameOrchestrator } from '../../src/engine/GameOrchestrator';
import { RoomService } from '../../src/engine/RoomService';
import { GameService } from '../../src/engine/GameService';
import { DayService } from '../../src/engine/DayService';
import { RoomTimerService, TimerJobType } from '../../src/engine/RoomTimerService';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { SchedulerPort, ScheduledJobHandle } from '../../src/engine/ports/SchedulerPort';

class TestClock implements ClockPort {
  private current = 0;
  now(): number { return this.current; }
  set(ms: number): void { this.current = ms; }
}

class DeterministicRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

class RecordingScheduler implements SchedulerPort {
  readonly scheduled: Array<{
    jobId: string;
    jobType: string;
    roomId: string;
    delayMs: number;
    payload: Record<string, unknown>;
  }> = [];
  private nextId = 1;

  async scheduleOnce(params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle> {
    const jobId = `timing-job-${this.nextId++}`;
    this.scheduled.push({ jobId, ...params });
    return { jobId };
  }

  async cancel(): Promise<void> {}
  onJobDue(): void {}
  async shutdown(): Promise<void> {}
}

function createDeps() {
  const storage = new InMemoryStorageAdapter();
  const clock = new TestClock();
  const random = new DeterministicRandom();
  const eventBus = new EventBus();
  const scheduler = new RecordingScheduler();
  const stateMachine = new GameStateMachine();
  const roleRegistry = createPhase1RoleRegistry();
  const distributionRegistry = createDefaultDistributionStrategyRegistry();
  const roomService = new RoomService(storage, clock, eventBus);
  const gameService = new GameService(storage, clock, random, eventBus, roleRegistry, distributionRegistry, stateMachine);
  const nightActionService = new NightActionService(storage, clock, random, eventBus, roleRegistry, stateMachine);
  const dayService = new DayService(storage, clock, eventBus, stateMachine);
  const timerService = new RoomTimerService(scheduler, storage, clock);
  const orchestrator = new GameOrchestrator(roomService, gameService, nightActionService, dayService, timerService);
  return { storage, clock, scheduler, nightActionService, timerService, orchestrator };
}

async function createTimingRoom(deps: ReturnType<typeof createDeps>): Promise<void> {
  const room = RoomFactory.create({
    id: 'wolf-at-55-room',
    hostTelegramId: 'wolf',
    chatId: 'chat-timing',
    now: 0,
    settingsOverride: {
      minPlayers: 6,
      maxPlayers: 6,
      enabledRoles: [RoleId.SEER, RoleId.BODYGUARD, RoleId.WITCH, RoleId.SILENT_MAGE],
      timers: { nightActionSeconds: 60, discussionSeconds: 180, votingSeconds: 60 },
    },
  });
  room.status = RoomStatus.LOCKED;
  room.gameState = GameState.FIRST_NIGHT;
  room.currentRound = 1;
  room.matchId = 'wolf-at-55-match';
  room.witchPotions = { saveUsed: false, poisonUsed: false };

  const roleData: Array<[string, RoleId, Team]> = [
    ['wolf', RoleId.WEREWOLF, Team.WEREWOLF],
    ['seer', RoleId.SEER, Team.VILLAGE],
    ['guard', RoleId.BODYGUARD, Team.VILLAGE],
    ['witch', RoleId.WITCH, Team.VILLAGE],
    ['mage', RoleId.SILENT_MAGE, Team.VILLAGE],
    ['villager', RoleId.VILLAGER, Team.VILLAGE],
  ];
  for (const [telegramId, role, team] of roleData) {
    const player = PlayerFactory.create({ telegramId, nickname: telegramId, isHost: telegramId === 'wolf', joinedAt: 0 });
    room.players[telegramId] = { ...player, role, team };
  }

  await deps.storage.saveRoom(room, -1);
}

describe('direct timing case: wolf submits at 55s, Witch gets a fresh 60s window', () => {
  it('starts Witch at t=55s and gives one shared 60s Witch window for save + poison', async () => {
    const deps = createDeps();
    await createTimingRoom(deps);

    const initialRoom = await deps.storage.getRoom('wolf-at-55-room');
    expect(initialRoom).not.toBeNull();
    const initialJobId = await deps.orchestrator.scheduleCurrentPhaseTimer(initialRoom!);
    expect(initialJobId).toBe('timing-job-1');
    expect(deps.scheduler.scheduled[0]).toMatchObject({
      jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
      delayMs: 60_000,
    });
    expect(await deps.timerService.getRemainingMs('wolf-at-55-room')).toBe(60_000);

    // Other regular roles act before the Wolf's final action.
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'seer-before-55', actorTelegramId: 'seer',
      actionType: NightActionType.SEER_INSPECT, targetTelegramId: 'wolf',
    });
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'guard-before-55', actorTelegramId: 'guard',
      actionType: NightActionType.BODYGUARD_PROTECT, targetTelegramId: 'villager',
    });
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'mage-before-55', actorTelegramId: 'mage',
      actionType: NightActionType.SILENT_MAGE_SILENCE, targetTelegramId: 'seer',
    });

    // Move the deterministic clock to second 55, then submit the Wolf target.
    deps.clock.set(55_000);
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'wolf-at-55', actorTelegramId: 'wolf',
      actionType: NightActionType.WEREWOLF_VOTE_KILL, targetTelegramId: 'villager',
    });

    expect(await deps.orchestrator.allNightActionsSubmitted('wolf-at-55-room')).toBe(true);
    expect(await deps.timerService.getRemainingMs('wolf-at-55-room')).toBe(5_000);

    // This is the same transition the Telegram flow performs after detecting
    // that all regular night actions have arrived early.
    const witchRoom = await deps.nightActionService.beginWitchPhase('wolf-at-55-room');
    expect(witchRoom.nightPhase).toBe(NightPhase.WITCH);
    expect(witchRoom.gameState).toBe(GameState.FIRST_NIGHT);

    const witchJobId = await deps.orchestrator.scheduleCurrentPhaseTimer(witchRoom);
    expect(witchJobId).toBe('timing-job-2');
    expect(deps.scheduler.scheduled[1]).toMatchObject({
      jobType: TimerJobType.WITCH_ACTION_TIMEOUT,
      delayMs: 60_000,
    });
    expect(await deps.timerService.getRemainingMs('wolf-at-55-room')).toBe(60_000);

    // Save and poison share this same Witch timer; there is no second 60s timer.
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'witch-save', actorTelegramId: 'witch',
      actionType: NightActionType.WITCH_SAVE, targetTelegramId: 'villager',
    });
    expect(await deps.orchestrator.allNightActionsSubmitted('wolf-at-55-room')).toBe(false);

    deps.clock.set(115_000);
    await deps.nightActionService.submitNightAction({
      roomId: 'wolf-at-55-room', actionId: 'witch-poison-skip', actorTelegramId: 'witch',
      actionType: NightActionType.WITCH_POISON, targetTelegramId: null,
    });
    expect(await deps.orchestrator.allNightActionsSubmitted('wolf-at-55-room')).toBe(true);
    expect(deps.scheduler.scheduled).toHaveLength(2);

    const result = await deps.orchestrator.resolveNight({
      roomId: 'wolf-at-55-room',
      promptHunter: async () => ({ targetTelegramId: null }),
    });
    expect(result.room.gameState).toBe(GameState.DAY);
    expect(result.room.nightPhase).toBe(NightPhase.ACTIONS);
    expect(result.room.players.villager.alive).toBe(true);
  });
});
