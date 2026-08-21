import { RoomService } from '../../src/engine/RoomService';
import { GameService } from '../../src/engine/GameService';
import { NightActionService } from '../../src/engine/NightActionService';
import { DayService } from '../../src/engine/DayService';
import { RoomTimerService } from '../../src/engine/RoomTimerService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../../src/engine/role-distribution/RoleDistributionStrategyRegistry';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { SchedulerPort, ScheduledJobHandle } from '../../src/engine/ports/SchedulerPort';
import { GameState, NightActionType, NightPhase, RoleId, Team } from '../../src/engine/domain/enums';
import { GameOrchestrator } from '../../src/engine/GameOrchestrator';

class FakeClock implements ClockPort {
  now(): number { return 1_000; }
}

class DeterministicRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

class NoopScheduler implements SchedulerPort {
  async scheduleOnce(_params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle> {
    return { jobId: `role-update-job-${Date.now()}` };
  }
  async cancel(): Promise<void> {}
  onJobDue(): void {}
  async shutdown(): Promise<void> {}
}

function createSetup() {
  const storage = new InMemoryStorageAdapter();
  const clock = new FakeClock();
  const eventBus = new EventBus();
  const stateMachine = new GameStateMachine();
  const roomService = new RoomService(storage, clock, eventBus);
  const roleRegistry = createPhase1RoleRegistry();
  const gameService = new GameService(
    storage,
    clock,
    new DeterministicRandom(),
    eventBus,
    roleRegistry,
    createDefaultDistributionStrategyRegistry(),
    stateMachine,
  );
  const nightActionService = new NightActionService(
    storage,
    clock,
    new DeterministicRandom(),
    eventBus,
    roleRegistry,
    stateMachine,
  );
  const dayService = new DayService(storage, clock, eventBus, stateMachine);
  const timerService = new RoomTimerService(new NoopScheduler(), storage, clock);
  const orchestrator = new GameOrchestrator(roomService, gameService, nightActionService, dayService, timerService);
  return { roomService, gameService, nightActionService, dayService, orchestrator };
}

async function startRoom(playerCount: number) {
  const setup = createSetup();
  await setup.roomService.createRoom({
    roomId: `role-update-${playerCount}`,
    hostTelegramId: 'p0',
    hostNickname: 'Host',
    chatId: `chat-${playerCount}`,
    settingsOverride: { minPlayers: playerCount, maxPlayers: playerCount },
  });
  for (let i = 1; i < playerCount; i += 1) {
    await setup.roomService.joinRoom({
      roomId: `role-update-${playerCount}`,
      telegramId: `p${i}`,
      nickname: `P${i}`,
    });
  }
  const room = await setup.gameService.startGame({
    roomId: `role-update-${playerCount}`,
    requestedByTelegramId: 'p0',
  });
  return { setup, room };
}

function roleCounts(room: Awaited<ReturnType<typeof startRoom>>['room']): Record<string, number> {
  return Object.values(room.players).reduce<Record<string, number>>((counts, player) => {
    const role = player.role ?? 'UNASSIGNED';
    counts[role] = (counts[role] ?? 0) + 1;
    return counts;
  }, {});
}

describe('role-update E2E: default 7/8-player presets', () => {
  it('keeps the 7-player default without Silent Mage', async () => {
    const { room } = await startRoom(7);
    expect(roleCounts(room)).toEqual({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.HUNTER]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.VILLAGER]: 1,
    });
    expect(Object.values(room.players).some((player) => player.role === RoleId.SILENT_MAGE)).toBe(false);
  });

  it('uses one Silent Mage instead of one Villager in the 8-player default', async () => {
    const { room } = await startRoom(8);
    expect(roleCounts(room)).toEqual({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.HUNTER]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 1,
    });
    expect(Object.values(room.players).filter((player) => player.role === RoleId.SILENT_MAGE)).toHaveLength(1);
    expect(Object.values(room.players).filter((player) => player.role === RoleId.VILLAGER)).toHaveLength(1);
    expect(new Set(Object.values(room.players).map((player) => player.role)).size).toBe(7);
  });

  it('runs the 8-player role-updated flow through night, Witch, DAY, DISCUSSION and VOTING', async () => {
    const { setup, room } = await startRoom(8);
    const roomId = 'role-update-8';
    const players = Object.values(room.players);
    const wolves = players.filter((player) => player.role === RoleId.WEREWOLF);
    const seer = players.find((player) => player.role === RoleId.SEER)!;
    const bodyguard = players.find((player) => player.role === RoleId.BODYGUARD)!;
    const witch = players.find((player) => player.role === RoleId.WITCH)!;
    const hunter = players.find((player) => player.role === RoleId.HUNTER)!;
    const mage = players.find((player) => player.role === RoleId.SILENT_MAGE)!;
    const victim = players.find((player) => player.role === RoleId.VILLAGER)!;

    for (const [index, wolf] of wolves.entries()) {
      await setup.nightActionService.submitNightAction({
        roomId,
        actionId: `wolf-${index}`,
        actorTelegramId: wolf.telegramId,
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: victim.telegramId,
      });
    }
    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'seer-action',
      actorTelegramId: seer.telegramId,
      actionType: NightActionType.SEER_INSPECT,
      targetTelegramId: wolves[0].telegramId,
    });
    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'bodyguard-action',
      actorTelegramId: bodyguard.telegramId,
      actionType: NightActionType.BODYGUARD_PROTECT,
      targetTelegramId: victim.telegramId,
    });
    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'hunter-action',
      actorTelegramId: hunter.telegramId,
      actionType: NightActionType.HUNTER_SHOOT,
      targetTelegramId: null,
    });
    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'silent-mage-action',
      actorTelegramId: mage.telegramId,
      actionType: NightActionType.SILENT_MAGE_SILENCE,
      targetTelegramId: seer.telegramId,
    });

    expect(await setup.orchestrator.allNightActionsSubmitted(roomId)).toBe(true);
    const witchPhase = await setup.nightActionService.beginWitchPhase(roomId);
    expect(witchPhase.gameState).toBe(GameState.FIRST_NIGHT);
    expect(witchPhase.nightPhase).toBe(NightPhase.WITCH);

    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'witch-save',
      actorTelegramId: witch.telegramId,
      actionType: NightActionType.WITCH_SAVE,
      targetTelegramId: victim.telegramId,
    });
    await setup.nightActionService.submitNightAction({
      roomId,
      actionId: 'witch-poison-skip',
      actorTelegramId: witch.telegramId,
      actionType: NightActionType.WITCH_POISON,
      targetTelegramId: null,
    });

    const nightResult = await setup.orchestrator.resolveNight({
      roomId,
      promptHunter: async () => ({ targetTelegramId: null }),
    });
    expect(nightResult.room.gameState).toBe(GameState.DAY);
    expect(nightResult.room.players[victim.telegramId].alive).toBe(true);

    const discussion = await setup.dayService.startDiscussion(roomId);
    expect(discussion.gameState).toBe(GameState.DISCUSSION);
    const voting = await setup.dayService.startVoting(roomId);
    expect(voting.gameState).toBe(GameState.VOTING);
    expect(voting.ballotId).toMatch(/^b-[0-9a-f]{16}-r1-v\d+$/);
    expect(Buffer.byteLength(`action:VOTE:${voting.ballotId}:${victim.telegramId}`, 'utf8')).toBeLessThanOrEqual(64);
    expect(Object.values(voting.players).filter((player) => player.role === RoleId.SILENT_MAGE)).toHaveLength(1);
    expect(Object.values(voting.players).filter((player) => player.role === RoleId.VILLAGER)).toHaveLength(1);
  });
});
