import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { GameOrchestrator } from '../../src/engine/GameOrchestrator';
import { DayService } from '../../src/engine/DayService';
import { GameService } from '../../src/engine/GameService';
import { NightActionService } from '../../src/engine/NightActionService';
import { RoomService } from '../../src/engine/RoomService';
import { RoomTimerService } from '../../src/engine/RoomTimerService';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameState, RoleId } from '../../src/engine/domain/enums';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { registerbottestCommand } from '../../src/telegram/commands/bottest';
import { GameFlowController } from '../../src/telegram/GameFlowController';
import { BotServices } from '../../src/telegram/BotServices';

const TOTAL_RUNS = Number(process.env.E2E_RUNS ?? '200');
const EXPECTED_SILENT_MAGE_RUNS = Math.floor(TOTAL_RUNS / 2);

class FakeClock implements ClockPort {
  now(): number {
    return 1000;
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

interface StressResult {
  run: number;
  requestedRole: RoleId;
  invariantMatch: boolean;
  elapsedMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  heapDeltaBytes: number;
  rssDeltaBytes: number;
  rounds: number;
  eventCount: number;
  telemetryObservationCount: number;
  finalState: GameState | undefined;
}

async function runScenario(run: number): Promise<StressResult> {
  const startedAt = performance.now();
  const cpuStarted = process.cpuUsage();
  const memoryStarted = process.memoryUsage();
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const random = new DeterministicRandom();
  const eventBus = new EventBus();
  const roleRegistry = createPhase1RoleRegistry();
  const distributionRegistry = createDefaultDistributionStrategyRegistry();
  const stateMachine = new GameStateMachine();
  const scheduler = {
    scheduleOnce: async () => ({ jobId: `stress-job-${run}` }),
    cancel: async () => undefined,
    onJobDue: () => undefined,
    shutdown: async () => undefined,
  };
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
  const bot = {
    command: jest.fn(),
    on: jest.fn(),
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({ message_id: run }),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
  const services = {
    storage,
    redis: {
      set: jest.fn().mockResolvedValue('OK'),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1),
    },
    roomService,
    gameService,
    nightActionService,
    dayService,
    timerService,
    orchestrator,
  } as unknown as BotServices;
  const handlers: Array<(ctx: any) => Promise<void>> = [];
  bot.command.mockImplementation((_name: string, handler: (ctx: any) => Promise<void>) => handlers.push(handler));
  registerbottestCommand(services, bot);

  const roomId = `stress-bottest-room-${run}`;
  await handlers[0]({
    chat: { type: 'group', id: roomId },
    from: { id: 99999990099, first_name: 'StressHost' },
    message: { text: `/bottest 6 ${run % 2 === 0 ? 'silentmage' : 'seer'}` },
    reply: jest.fn().mockResolvedValue(undefined),
  });
  let room = await storage.getRoom(roomId);
  expect(room?.players).toBeDefined();
  expect(Object.keys(room!.players)).toHaveLength(6);
  expect(room!.requestedRoleOverride).toBe(run % 2 === 0 ? RoleId.SILENT_MAGE : RoleId.SEER);

  room = await gameService.startGame({ roomId, requestedByTelegramId: '99999990099' });
  expect(room.players['99999990099'].role).toBe(run % 2 === 0 ? RoleId.SILENT_MAGE : RoleId.SEER);
  const controller = new GameFlowController(services, bot);
  await controller.onGameStarted(room);

  let current = await storage.getRoom(roomId);
  const phaseHistory: GameState[] = [current!.gameState];
  for (let round = 0; round < 12 && current?.gameState !== GameState.GAME_OVER; round += 1) {
    if (current?.gameState === GameState.DISCUSSION) {
      await controller.startVoting(roomId);
    }
    current = await storage.getRoom(roomId);
    if (current) phaseHistory.push(current.gameState);
  }

  expect(phaseHistory).toContain(GameState.DISCUSSION);
  expect(phaseHistory).toContain(GameState.GAME_OVER);
  const events = await storage.getEvents(current!.matchId!);
  const eventTypes = events.map((event) => event.type);
  expect(eventTypes).toEqual(expect.arrayContaining([
    'GAME_STARTED',
    'ROLES_ASSIGNED',
    'NIGHT_RESOLVED',
    'EXECUTION_RESOLVED',
    'WIN_CONDITION_MET',
    'GAME_ENDED',
  ]));
  const telemetry = controller.botPolicy.getTelemetry(roomId);
  expect(telemetry.voteCount).toBeGreaterThan(0);

  const requestedRole = room.requestedRoleOverride ?? RoleId.SEER;
  const discussionRounds = phaseHistory.filter((state) => state === GameState.DISCUSSION).length;
  const hasSilentMageAction = events.some((event) => event.type === 'NIGHT_ACTION_SUBMITTED'
    && (event.payload as { actionType?: string }).actionType === 'SILENT_MAGE_SILENCE');
  const invariantMatch = current?.gameState === GameState.GAME_OVER
    && events.length > 0
    && discussionRounds > 0
    && telemetry.observationCount > 0
    && (requestedRole === RoleId.SILENT_MAGE ? hasSilentMageAction : events.length === 38 && discussionRounds === 1 && telemetry.observationCount === 6);
  expect(invariantMatch).toBe(true);

  const cpuUsed = process.cpuUsage(cpuStarted);
  const memoryEnded = process.memoryUsage();
  return {
    run,
    requestedRole,
    invariantMatch,
    elapsedMs: performance.now() - startedAt,
    cpuUserMs: cpuUsed.user / 1000,
    cpuSystemMs: cpuUsed.system / 1000,
    heapDeltaBytes: memoryEnded.heapUsed - memoryStarted.heapUsed,
    rssDeltaBytes: memoryEnded.rss - memoryStarted.rss,
      rounds: discussionRounds,
    eventCount: events.length,
    telemetryObservationCount: telemetry.observationCount,
    finalState: current?.gameState,
  };
}

describe('Silent Mage 200-round E2E regression and stress flow', () => {
  it('passes 200 deterministic full-flow rounds and writes performance metrics', async () => {
    jest.useFakeTimers();
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const results: StressResult[] = [];
    try {
      for (let run = 1; run <= TOTAL_RUNS; run += 1) {
        results.push(await runScenario(run));
        jest.clearAllTimers();
      }
    } finally {
      randomSpy.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }

    const elapsed = results.map((result) => result.elapsedMs);
    const totalElapsedMs = elapsed.reduce((sum, value) => sum + value, 0);
      const metrics = {
      runs: results.length,
      passedRuns: results.filter((result) => result.finalState === GameState.GAME_OVER).length,
      invariantMatches: results.filter((result) => result.invariantMatch).length,
      baselineMatches: results.filter((result) => result.requestedRole === RoleId.SEER && result.eventCount === 38 && result.rounds === 1 && result.telemetryObservationCount === 6).length,
      silentMageRuns: results.filter((result) => result.requestedRole === RoleId.SILENT_MAGE).length,
      silentMageInvariantMatches: results.filter((result) => result.requestedRole === RoleId.SILENT_MAGE && result.invariantMatch).length,
      totalElapsedMs,
      averageElapsedMs: totalElapsedMs / results.length,
      maxElapsedMs: Math.max(...elapsed),
      minElapsedMs: Math.min(...elapsed),
      totalCpuUserMs: results.reduce((sum, result) => sum + result.cpuUserMs, 0),
      totalCpuSystemMs: results.reduce((sum, result) => sum + result.cpuSystemMs, 0),
      maxHeapDeltaBytes: Math.max(...results.map((result) => result.heapDeltaBytes)),
      minHeapDeltaBytes: Math.min(...results.map((result) => result.heapDeltaBytes)),
      maxRssDeltaBytes: Math.max(...results.map((result) => result.rssDeltaBytes)),
      minRssDeltaBytes: Math.min(...results.map((result) => result.rssDeltaBytes)),
      totalEvents: results.reduce((sum, result) => sum + result.eventCount, 0),
      totalTelemetryObservations: results.reduce((sum, result) => sum + result.telemetryObservationCount, 0),
      results,
    };
    writeFileSync('silent-mage-e2e-200-results.json', JSON.stringify(metrics, null, 2));
    expect(metrics.runs).toBe(TOTAL_RUNS);
    expect(metrics.passedRuns).toBe(TOTAL_RUNS);
    expect(metrics.invariantMatches).toBe(TOTAL_RUNS);
    expect(metrics.baselineMatches).toBe(TOTAL_RUNS - EXPECTED_SILENT_MAGE_RUNS);
    expect(metrics.silentMageRuns).toBe(EXPECTED_SILENT_MAGE_RUNS);
    expect(metrics.silentMageInvariantMatches).toBe(EXPECTED_SILENT_MAGE_RUNS);
    expect(metrics.totalEvents).toBeGreaterThan(0);
    expect(metrics.totalTelemetryObservations).toBeGreaterThan(0);
  }, 240000);
});
