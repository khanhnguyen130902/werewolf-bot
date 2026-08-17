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
import { registerVoteCommand } from '../../src/telegram/commands/vote';
import { GameFlowController } from '../../src/telegram/GameFlowController';
import { BotServices } from '../../src/telegram/BotServices';

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

describe('bottest end-to-end flow', () => {
  it('creates a bot room, starts the match, resolves repeated night/day rounds, and reaches game over', async () => {
    jest.useFakeTimers();
    const mathRandom = jest.spyOn(Math, 'random').mockReturnValue(0.99);

    const storage = new InMemoryStorageAdapter();
    const clock = new FakeClock();
    const random = new DeterministicRandom();
    const eventBus = new EventBus();
    const roleRegistry = createPhase1RoleRegistry();
    const distributionRegistry = createDefaultDistributionStrategyRegistry();
    const stateMachine = new GameStateMachine();
    const scheduler = {
      scheduleOnce: jest.fn().mockResolvedValue({ jobId: 'e2e-job' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      onJobDue: jest.fn(),
      shutdown: jest.fn().mockResolvedValue(undefined),
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

    const sendMessage = jest.fn().mockResolvedValue({ message_id: 1 });
    const bot = {
      command: jest.fn(),
      on: jest.fn(),
      telegram: {
        sendMessage,
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

    const commandHandlers: Array<(ctx: any) => Promise<void>> = [];
    bot.command.mockImplementation((_name: string, handler: (ctx: any) => Promise<void>) => {
      commandHandlers.push(handler);
    });
    registerbottestCommand(services, bot);

    const roomId = 'e2e-bottest-room';
    await commandHandlers[0]({
      chat: { type: 'group', id: roomId },
      from: { id: 99999990099, first_name: 'TestHost' },
      message: { text: '/bottest 6 seer' },
      reply: jest.fn().mockResolvedValue(undefined),
    });

    let room = await storage.getRoom(roomId);
    expect(room).not.toBeNull();
    expect(Object.keys(room!.players)).toHaveLength(6);
    expect(room!.requestedRoleOverride).toBe(RoleId.SEER);

    room = await gameService.startGame({
      roomId,
      requestedByTelegramId: '99999990099',
    });
    expect(room.gameState).toBe(GameState.FIRST_NIGHT);
    expect(room.players['99999990099'].role).toBe(RoleId.SEER);

    const controller = new GameFlowController(services, bot);
    registerVoteCommand(services, controller, bot);
    await controller.onGameStarted(room);

    let current = await storage.getRoom(roomId);
    expect(current?.gameState).toBe(GameState.DISCUSSION);

    const phaseHistory: GameState[] = [current!.gameState];
    let voteCommandInvocations = 0;
    for (let round = 0; round < 10 && current?.gameState !== GameState.GAME_OVER; round += 1) {
      if (current?.gameState === GameState.DISCUSSION) {
        const voteReply = jest.fn().mockResolvedValue(undefined);
        await commandHandlers[1]({
          chat: { type: 'group', id: roomId },
          from: { id: 99999990099 },
          message: { text: '/vote' },
          reply: voteReply,
        });
        voteCommandInvocations += 1;
        // A successful start may immediately resolve in the deterministic bot
        // scenario; either way the command itself must not throw.
        expect(voteReply).not.toHaveBeenCalledWith(expect.stringContaining('Có lỗi xảy ra'));
      }
      current = await storage.getRoom(roomId);
      if (current) phaseHistory.push(current.gameState);
    }

    // Calling /vote again after the phase has advanced must be handled as a
    // friendly phase response, not leak an INVALID_PHASE_ACTION exception.
    const duplicateVoteReply = jest.fn().mockResolvedValue(undefined);
    await commandHandlers[1]({
      chat: { type: 'group', id: roomId },
      from: { id: 99999990099 },
      message: { text: '/vote' },
      reply: duplicateVoteReply,
    });
    expect(voteCommandInvocations).toBeGreaterThan(0);
    expect(duplicateVoteReply).toHaveBeenCalledWith(expect.any(String));
    expect(duplicateVoteReply.mock.calls[0][0]).not.toBe('');

    expect(current?.gameState).toBe(GameState.GAME_OVER);
    expect(phaseHistory).toContain(GameState.DISCUSSION);
    expect(phaseHistory).toContain(GameState.GAME_OVER);
    expect(scheduler.scheduleOnce).toHaveBeenCalled();
    expect(scheduler.cancel).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();

    const events = await storage.getEvents(current!.matchId!);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain('GAME_STARTED');
    expect(eventTypes).toContain('NIGHT_RESOLVED');
    expect(eventTypes).toContain('EXECUTION_RESOLVED');
    expect(eventTypes).toContain('WIN_CONDITION_MET');
    expect(eventTypes).toContain('GAME_ENDED');

    mathRandom.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
