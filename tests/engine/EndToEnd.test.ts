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

/**
 * Full end-to-end simulation: create a room, join 8 players, start the
 * match, resolve the first night (werewolves kill a villager), run a full
 * day cycle (discussion -> voting -> execute another villager), and repeat
 * until the werewolves reach parity and win. This exercises every service
 * built across Phases 1-4 working together, the way the Telegram layer
 * (Phase 6) eventually will.
 */
describe('End-to-end match simulation', () => {
  it('plays a full match from room creation to a werewolf victory', async () => {
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

    const allEvents: string[] = [];
    eventBus.subscribe((e) => {
      allEvents.push(e.type);
    });

    await roomService.createRoom({
      roomId: 'e2e-room',
      hostTelegramId: 'host',
      hostNickname: 'Host',
      chatId: 'chat-e2e',
      settingsOverride: { minPlayers: 6, maxPlayers: 20, enabledRoles: ['SEER'] },
    });
    for (let i = 1; i <= 7; i++) {
      await roomService.joinRoom({
        roomId: 'e2e-room',
        telegramId: `player${i}`,
        nickname: `Player${i}`,
      });
    }

    let room = await gameService.startGame({
      roomId: 'e2e-room',
      requestedByTelegramId: 'host',
    });
    expect(room.gameState).toBe(GameState.FIRST_NIGHT);

    const wolves = Object.values(room.players).filter((p) => p.role === RoleId.WEREWOLF);
    expect(wolves).toHaveLength(2);
    const seer = Object.values(room.players).find((p) => p.role === RoleId.SEER)!;
    expect(seer).toBeDefined();

    let round = 1;
    const maxRounds = 10;
    let winnerFound = false;

    while (!winnerFound && round <= maxRounds) {
      const currentRoom = (await gameService.getRoom('e2e-room'))!;
      const aliveVillagers = Object.values(currentRoom.players).filter(
        (p) => p.alive && p.role === RoleId.VILLAGER,
      );
      const aliveWolves = Object.values(currentRoom.players).filter(
        (p) => p.alive && p.role === RoleId.WEREWOLF,
      );
      const aliveSeer = Object.values(currentRoom.players).find(
        (p) => p.alive && p.role === RoleId.SEER,
      );

      if (aliveVillagers.length === 0) break;

      const victim = aliveVillagers[0];

      for (const [idx, wolf] of aliveWolves.entries()) {
        await nightActionService.submitNightAction({
          roomId: 'e2e-room',
          actionId: `night-${round}-wolf-${idx}`,
          actorTelegramId: wolf.telegramId,
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: victim.telegramId,
        });
      }

      if (aliveSeer && aliveVillagers.length > 1) {
        await nightActionService.submitNightAction({
          roomId: 'e2e-room',
          actionId: `night-${round}-seer`,
          actorTelegramId: aliveSeer.telegramId,
          actionType: NightActionType.SEER_INSPECT,
          targetTelegramId: aliveVillagers[aliveVillagers.length - 1].telegramId,
        });
      }

      const nightResult = await nightActionService.resolveNight({
        roomId: 'e2e-room',
        getHunterDecision: () => null,
      });

      if (nightResult.room.gameState === GameState.GAME_OVER) {
        winnerFound = true;
        room = nightResult.room;
        break;
      }

      expect(nightResult.room.gameState).toBe(GameState.DAY);

      await dayService.startDiscussion('e2e-room');
      await dayService.startVoting('e2e-room');

      const afterNightRoom = (await gameService.getRoom('e2e-room'))!;
      const aliveNow = Object.values(afterNightRoom.players).filter((p) => p.alive);
      const executionTarget = aliveNow.find(
        (p) => p.role === RoleId.VILLAGER && p.telegramId !== victim.telegramId,
      );

      if (!executionTarget) {
        for (const [idx, voter] of aliveNow.entries()) {
          await dayService.submitVote({
            roomId: 'e2e-room',
            actionId: `vote-${round}-${idx}`,
            voterTelegramId: voter.telegramId,
            targetTelegramId: null,
          });
        }
      } else {
        for (const [idx, voter] of aliveNow.entries()) {
          await dayService.submitVote({
            roomId: 'e2e-room',
            actionId: `vote-${round}-${idx}`,
            voterTelegramId: voter.telegramId,
            targetTelegramId: executionTarget.telegramId,
          });
        }
      }

      const dayResult = await dayService.resolveExecution({
        roomId: 'e2e-room',
        getHunterDecision: () => null,
      });

      room = dayResult.room;
      if (room.gameState === GameState.GAME_OVER) {
        winnerFound = true;
      }

      round++;
    }

    expect(winnerFound).toBe(true);
    expect(room.gameState).toBe(GameState.GAME_OVER);

    expect(allEvents).toContain('ROOM_CREATED');
    expect(allEvents).toContain('GAME_STARTED');
    expect(allEvents).toContain('ROLES_ASSIGNED');
    expect(allEvents).toContain('NIGHT_RESOLVED');
    expect(allEvents).toContain('EXECUTION_RESOLVED');
    expect(allEvents).toContain('WIN_CONDITION_MET');
    expect(allEvents).toContain('GAME_ENDED');

    const persistedEvents = await storage.getEvents(room.matchId!);
    expect(persistedEvents.length).toBeGreaterThan(0);
  });
});
