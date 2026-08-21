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
import { DuplicateActionError, StaleResolutionError } from '../../src/engine/errors/DomainError';

class FakeClock implements ClockPort {
  now(): number { return 1000; }
}

class DeterministicRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

function setup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const eventBus = new EventBus();
  const stateMachine = new GameStateMachine();
  const registry = createPhase1RoleRegistry();
  const distribution = createDefaultDistributionStrategyRegistry();
  const random = new DeterministicRandom();
  const roomService = new RoomService(storage, clock, eventBus);
  const gameService = new GameService(storage, clock, random, eventBus, registry, distribution, stateMachine);
  const nightActionService = new NightActionService(storage, clock, random, eventBus, registry, stateMachine);
  const dayService = new DayService(storage, clock, eventBus, stateMachine);
  return { storage, roomService, gameService, nightActionService, dayService };
}

async function createStartedGame(deps: ReturnType<typeof setup>) {
  await deps.roomService.createRoom({
    roomId: 'room1',
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: 'chat1',
    settingsOverride: { minPlayers: 6, maxPlayers: 15 },
  });
  for (let index = 1; index < 7; index += 1) {
    await deps.roomService.joinRoom({ roomId: 'room1', telegramId: `p${index}`, nickname: `P${index}` });
  }
  await deps.gameService.startGame({ roomId: 'room1', requestedByTelegramId: 'p0' });
}

async function advanceToVoting(deps: ReturnType<typeof setup>) {
  await createStartedGame(deps);
  await deps.nightActionService.resolveNight({ roomId: 'room1', getHunterDecision: () => null });
  await deps.dayService.startDiscussion('room1');
  return deps.dayService.startVoting('room1');
}

describe('concurrency audit', () => {
  it('serializes concurrent votes from the same player', async () => {
    const deps = setup();
    const room = await advanceToVoting(deps);
    const voter = Object.values(room.players).find((player) => player.telegramId === 'p0')!;
    const target = Object.values(room.players).find((player) => player.telegramId !== voter.telegramId)!;
    const results = await Promise.allSettled([
      deps.dayService.submitVote({ roomId: 'room1', actionId: 'race-vote-a', voterTelegramId: voter.telegramId, targetTelegramId: target.telegramId }),
      deps.dayService.submitVote({ roomId: 'room1', actionId: 'race-vote-b', voterTelegramId: voter.telegramId, targetTelegramId: target.telegramId }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(DuplicateActionError);
    expect((await deps.storage.getRoom('room1'))!.players[voter.telegramId].hasVotedThisRound).toBe(true);
  });

  it('allows only one concurrent night finalization to commit', async () => {
    const deps = setup();
    await createStartedGame(deps);
    const results = await Promise.allSettled([
      deps.nightActionService.resolveNight({ roomId: 'room1', getHunterDecision: () => null }),
      deps.nightActionService.resolveNight({ roomId: 'room1', getHunterDecision: () => null }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(StaleResolutionError);
    expect((await deps.storage.getRoom('room1'))!.gameState).toBe(GameState.DAY);
  });

  it('allows only one concurrent execution finalization to commit', async () => {
    const deps = setup();
    const room = await advanceToVoting(deps);
    const target = Object.values(room.players).find((player) => player.role === RoleId.VILLAGER)!;
    const voters = Object.values(room.players).filter((player) => player.telegramId !== target.telegramId).slice(0, 3);
    for (const [index, voter] of voters.entries()) {
      await deps.dayService.submitVote({ roomId: 'room1', actionId: `race-execution-vote-${index}`, voterTelegramId: voter.telegramId, targetTelegramId: target.telegramId });
    }

    const results = await Promise.allSettled([
      deps.dayService.resolveExecution({ roomId: 'room1', getHunterDecision: () => null }),
      deps.dayService.resolveExecution({ roomId: 'room1', getHunterDecision: () => null }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(StaleResolutionError);
    expect((await deps.storage.getRoom('room1'))!.gameState).toBe(GameState.NIGHT);
  });
});
