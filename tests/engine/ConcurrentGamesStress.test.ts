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

class FixedClock implements ClockPort {
  now(): number { return 1000; }
}

class FixedRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

function createServices() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FixedClock();
  const random = new FixedRandom();
  const eventBus = new EventBus();
  const stateMachine = new GameStateMachine();
  const roles = createPhase1RoleRegistry();
  const distribution = createDefaultDistributionStrategyRegistry();
  const roomService = new RoomService(storage, clock, eventBus);
  const gameService = new GameService(storage, clock, random, eventBus, roles, distribution, stateMachine);
  const nightActionService = new NightActionService(storage, clock, random, eventBus, roles, stateMachine);
  const dayService = new DayService(storage, clock, eventBus, stateMachine);
  const scheduler = {
    scheduleOnce: async ({ roomId }: { roomId: string }) => ({ jobId: `stress-${roomId}` }),
    cancel: async () => undefined,
    onJobDue: () => undefined,
    shutdown: async () => undefined,
  };
  const timerService = new RoomTimerService(scheduler, storage, clock);
  const orchestrator = new GameOrchestrator(roomService, gameService, nightActionService, dayService, timerService);
  return { storage, roomService, gameService, nightActionService, dayService, orchestrator };
}

async function runRoom(roomId: string, deps: ReturnType<typeof createServices>) {
  await deps.roomService.createRoom({
    roomId,
    hostTelegramId: `${roomId}-p0`,
    hostNickname: 'Host',
    chatId: `${roomId}-chat`,
    settingsOverride: { minPlayers: 6, maxPlayers: 15 },
  });
  for (let index = 1; index < 6; index += 1) {
    await deps.roomService.joinRoom({ roomId, telegramId: `${roomId}-p${index}`, nickname: `P${index}` });
  }
  const started = await deps.gameService.startGame({ roomId, requestedByTelegramId: `${roomId}-p0` });
  await deps.nightActionService.resolveNight({ roomId, getHunterDecision: () => null });
  await deps.dayService.startDiscussion(roomId);
  await deps.dayService.startVoting(roomId);
  const current = await deps.storage.getRoom(roomId);
  const alive = Object.values(current!.players).filter((player) => player.alive);
  const target = alive.find((player) => player.role === RoleId.WEREWOLF) ?? alive[0];
  for (const [index, voter] of alive.filter((player) => player.telegramId !== target.telegramId).entries()) {
    await deps.dayService.submitVote({
      roomId,
      actionId: `${roomId}-vote-${index}`,
      voterTelegramId: voter.telegramId,
      targetTelegramId: target.telegramId,
      ballotId: current!.ballotId,
    });
  }
  await deps.dayService.resolveExecution({ roomId, getHunterDecision: () => null });
  const finished = await deps.storage.getRoom(roomId);
  const events = await deps.storage.getEvents(finished!.matchId!);
  return { roomId, startedState: started.gameState, finalState: finished!.gameState, playerCount: Object.keys(finished!.players).length, eventCount: events.length, matchId: finished!.matchId };
}

describe('concurrent game stress', () => {
  it('runs 8 independent games concurrently without cross-room state leakage', async () => {
    const deps = createServices();
    const roomIds = Array.from({ length: 8 }, (_, index) => `concurrent-room-${index + 1}`);
    const startedAt = performance.now();
    const results = await Promise.all(roomIds.map((roomId) => runRoom(roomId, deps)));
    const elapsedMs = performance.now() - startedAt;

    expect(results).toHaveLength(8);
    expect(new Set(results.map((result) => result.matchId)).size).toBe(8);
    expect(results.every((result) => result.playerCount === 6)).toBe(true);
    expect(results.every((result) => result.eventCount > 0)).toBe(true);
    expect(results.every((result) => [GameState.NIGHT, GameState.GAME_OVER].includes(result.finalState))).toBe(true);
    expect(await deps.storage.listActiveRoomIds()).toHaveLength(8);

    // Keep a compact metric in the Jest output for the final audit report.
    expect(elapsedMs).toBeLessThan(30000);
  }, 60000);
});
