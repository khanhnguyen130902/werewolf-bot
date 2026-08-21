import { GameService } from '../../src/engine/GameService';
import { RoomService } from '../../src/engine/RoomService';
import { NightActionService } from '../../src/engine/NightActionService';
import { DayService } from '../../src/engine/DayService';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameState, NightActionType, RoleId } from '../../src/engine/domain/enums';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';

class FixedClock implements ClockPort {
  now(): number { return 1000; }
}

class SeededRandom implements RandomPort {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.next() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }
  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

function createServices(random: RandomPort) {
  const storage = new InMemoryStorageAdapter();
  const clock = new FixedClock();
  const eventBus = new EventBus();
  const stateMachine = new GameStateMachine();
  const roles = createPhase1RoleRegistry();
  const distribution = createDefaultDistributionStrategyRegistry();
  const roomService = new RoomService(storage, clock, eventBus);
  const gameService = new GameService(storage, clock, random, eventBus, roles, distribution, stateMachine);
  const nightActionService = new NightActionService(storage, clock, random, eventBus, roles, stateMachine);
  const dayService = new DayService(storage, clock, eventBus, stateMachine);
  return { storage, roomService, gameService, nightActionService, dayService, roles, random };
}

const NIGHT_ACTION_BY_ROLE: Partial<Record<RoleId, NightActionType>> = {
  [RoleId.WEREWOLF]: NightActionType.WEREWOLF_VOTE_KILL,
  [RoleId.SEER]: NightActionType.SEER_INSPECT,
  [RoleId.BODYGUARD]: NightActionType.BODYGUARD_PROTECT,
  [RoleId.SILENT_MAGE]: NightActionType.SILENT_MAGE_SILENCE,
};

async function runSeed(seed: number) {
  const playerCount = 6 + (seed % 7);
  const roomId = `random-room-${seed}`;
  const deps = createServices(new SeededRandom(seed));
  await deps.roomService.createRoom({
    roomId,
    hostTelegramId: `${roomId}-p0`,
    hostNickname: 'Host',
    chatId: `${roomId}-chat`,
    settingsOverride: { minPlayers: 6, maxPlayers: 15 },
  });
  for (let index = 1; index < playerCount; index += 1) {
    await deps.roomService.joinRoom({ roomId, telegramId: `${roomId}-p${index}`, nickname: `P${index}` });
  }

  let room = await deps.gameService.startGame({ roomId, requestedByTelegramId: `${roomId}-p0` });
  const deadIds = new Set<string>();
  const previousNightTargets = new Map<string, string | null>();
  const stateHistory: GameState[] = [room.gameState];

  for (let round = 0; round < 6 && room.gameState !== GameState.GAME_OVER; round += 1) {
    const alive = Object.values(room.players).filter((player) => player.alive);
    for (const player of alive) {
      const actionType = player.role ? NIGHT_ACTION_BY_ROLE[player.role] : undefined;
      if (!actionType) continue;
      const targets = alive.filter((target) =>
        target.telegramId !== player.telegramId || player.role === RoleId.WEREWOLF,
      );
      const previousTarget = previousNightTargets.get(player.telegramId);
      const cannotRepeat = player.role === RoleId.SEER || player.role === RoleId.BODYGUARD;
      const alternativeTargets = cannotRepeat && previousTarget
        ? targets.filter((target) => target.telegramId !== previousTarget)
        : targets;
      const selectableTargets = alternativeTargets.length > 0 ? alternativeTargets : targets;
      const target = selectableTargets.length > 0 ? deps.random.pick(selectableTargets) : null;
      previousNightTargets.set(player.telegramId, target?.telegramId ?? null);
      await deps.nightActionService.submitNightAction({
        roomId,
        actionId: `random-${seed}-${round}-${player.telegramId}-${actionType}`,
        actorTelegramId: player.telegramId,
        actionType,
        targetTelegramId: target?.telegramId ?? null,
      });
    }

    await deps.nightActionService.resolveNight({ roomId, getHunterDecision: () => null });
    room = (await deps.storage.getRoom(roomId))!;
    stateHistory.push(room.gameState);
    if (room.gameState === GameState.GAME_OVER) break;

    if (room.gameState === GameState.DAY) {
      await deps.dayService.startDiscussion(roomId);
    }
    room = (await deps.storage.getRoom(roomId))!;
    if (room.gameState === GameState.GAME_OVER) break;
    await deps.dayService.startVoting(roomId);
    room = (await deps.storage.getRoom(roomId))!;

    const currentAlive = Object.values(room.players).filter((player) => player.alive);
    for (const voter of currentAlive) {
      const target = deps.random.next() < 0.15 ? null : deps.random.pick(currentAlive);
      await deps.dayService.submitVote({
        roomId,
        actionId: `random-${seed}-${round}-vote-${voter.telegramId}`,
        voterTelegramId: voter.telegramId,
        targetTelegramId: target?.telegramId ?? null,
        ballotId: room.ballotId,
      });
    }
    await deps.dayService.resolveExecution({ roomId, getHunterDecision: () => null });
    room = (await deps.storage.getRoom(roomId))!;
    stateHistory.push(room.gameState);

    const currentAliveIds = new Set(Object.values(room.players).filter((player) => player.alive).map((player) => player.telegramId));
    for (const playerId of deadIds) {
      expect(currentAliveIds.has(playerId)).toBe(false);
    }
    for (const player of Object.values(room.players)) {
      if (!player.alive) deadIds.add(player.telegramId);
    }
  }

  return { room, stateHistory };
}

describe('seeded randomized gameplay invariants', () => {
  it('preserves player/death/state invariants across 25 randomized games', async () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { room, stateHistory } = await runSeed(seed);
      expect(new Set(Object.keys(room.players)).size).toBe(Object.keys(room.players).length);
      expect(stateHistory.every((state) => Object.values(GameState).includes(state))).toBe(true);
      expect(room.gameState === GameState.GAME_OVER || room.currentRound <= 7).toBe(true);
      expect(Object.values(room.players).every((player) => player.alive || player.alive === false)).toBe(true);
    }
  }, 120000);
});
