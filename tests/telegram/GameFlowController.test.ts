import { GameFlowController } from '../../src/telegram/GameFlowController';
import { Messages } from '../../src/telegram/presenters/messages';
import { GameState, NightActionType, NightPhase, RoleId } from '../../src/engine/domain/enums';
import { TimerJobType } from '../../src/engine/RoomTimerService';

describe('GameFlowController', () => {
  it('records Skip for a bot when its chosen night-action target is rejected', async () => {
    const submitNightAction = jest
      .fn()
      .mockRejectedValueOnce(new Error('Bodyguard cannot protect the same target consecutively'))
      .mockResolvedValueOnce(undefined);
    const services = {
      nightActionService: { submitNightAction },
      storage: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn() } } as any;
    const controller = new GameFlowController(services, bot);

    await (controller as any).submitBotNightAction({
      room: { id: 'room1', currentRound: 2 },
      player: { telegramId: '9999999001' },
      actionType: NightActionType.BODYGUARD_PROTECT,
      targetTelegramId: 'seer',
    });

    expect(submitNightAction).toHaveBeenCalledTimes(2);
    expect(submitNightAction).toHaveBeenLastCalledWith(expect.objectContaining({
      actorTelegramId: '9999999001',
      actionType: NightActionType.BODYGUARD_PROTECT,
      targetTelegramId: null,
    }));
  });

  it('records Skip when a bot Bodyguard has no legal target', async () => {
    const submitNightAction = jest.fn().mockResolvedValue(undefined);
    const services = {
      nightActionService: { submitNightAction },
      orchestrator: {
        scheduleCurrentPhaseTimer: jest.fn().mockResolvedValue(null),
        allNightActionsSubmitted: jest.fn().mockResolvedValue(false),
      },
      storage: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) } } as any;
    const controller = new GameFlowController(services, bot);
    const room = {
      id: 'room1',
      chatId: 'chat1',
      currentRound: 1,
      settings: { bodyguardAllowSelfProtect: false },
      players: {
        '9999999001': {
          telegramId: '9999999001', nickname: 'Bodyguard Bot', alive: true, role: RoleId.BODYGUARD,
        },
      },
      lastProtectedByBodyguard: {},
      lastTargetedByHunter: {},
      pendingNightActions: [],
    } as any;

    await (controller as any).startNightPrompts(room);

    expect(submitNightAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: NightActionType.BODYGUARD_PROTECT,
      targetTelegramId: null,
    }));
  });

  it('ignores a stale night-action timeout from an earlier round', async () => {
    const handlers = new Map<string, (roomId: string, payload: Record<string, unknown>) => Promise<void>>();
    const beginWitchPhase = jest.fn();
    const resolveNight = jest.fn();
    const services = {
      roomService: { getRoom: jest.fn().mockResolvedValue({
        id: 'room1',
        gameState: GameState.NIGHT,
        currentRound: 2,
        nightPhase: NightPhase.ACTIONS,
      }) },
      timerService: {
        onTimeout: jest.fn((jobType: string, handler: (roomId: string, payload: Record<string, unknown>) => Promise<void>) => {
          handlers.set(jobType, handler);
        }),
      },
      orchestrator: { beginWitchPhase },
      storage: {},
      dayService: {},
      nightActionService: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) } } as any;
    const controller = new GameFlowController(services, bot);
    (controller as any).resolveNight = resolveNight;
    controller.registerTimeoutHandlers();

    await handlers.get(TimerJobType.NIGHT_ACTION_TIMEOUT)!('room1', {
      round: 1,
      nightPhase: NightPhase.ACTIONS,
    });

    expect(beginWitchPhase).not.toHaveBeenCalled();
    expect(resolveNight).not.toHaveBeenCalled();
  });

  it('ignores a stale Witch timeout from an earlier round', async () => {
    const handlers = new Map<string, (roomId: string, payload: Record<string, unknown>) => Promise<void>>();
    const resolveNight = jest.fn();
    const services = {
      roomService: { getRoom: jest.fn().mockResolvedValue({
        id: 'room1',
        gameState: GameState.NIGHT,
        currentRound: 2,
        nightPhase: NightPhase.WITCH,
      }) },
      timerService: {
        onTimeout: jest.fn((jobType: string, handler: (roomId: string, payload: Record<string, unknown>) => Promise<void>) => {
          handlers.set(jobType, handler);
        }),
      },
      orchestrator: {},
      storage: {},
      dayService: {},
      nightActionService: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) } } as any;
    const controller = new GameFlowController(services, bot);
    (controller as any).resolveNight = resolveNight;
    controller.registerTimeoutHandlers();

    await handlers.get(TimerJobType.WITCH_ACTION_TIMEOUT)!('room1', { round: 1 });

    expect(resolveNight).not.toHaveBeenCalled();
  });

  it('preserves the active night timer when /vote is rejected in an invalid phase', async () => {
    const startVoting = jest.fn().mockRejectedValue(
      Object.assign(new Error('Room is still in FIRST_NIGHT'), { code: 'INVALID_PHASE_ACTION' }),
    );
    const cancelCurrentPhaseTimer = jest.fn().mockResolvedValue(undefined);
    const services = {
      dayService: { startVoting },
      orchestrator: {
        scheduleCurrentPhaseTimer: jest.fn().mockResolvedValue('night-job-1'),
        allNightActionsSubmitted: jest.fn().mockResolvedValue(false),
        cancelCurrentPhaseTimer,
      },
      storage: {},
      redis: {},
    } as any;
    const bot = {
      on: jest.fn(),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;
    const controller = new GameFlowController(services, bot);
    const roomId = 'invalid-vote-preserves-timer';

    await (controller as any).startNightPrompts({
      id: roomId,
      chatId: 'chat1',
      currentRound: 1,
      players: {},
      settings: { timers: { nightActionSeconds: 60 } },
    });

    await expect(controller.startVoting(roomId)).rejects.toMatchObject({ code: 'INVALID_PHASE_ACTION' });
    expect(cancelCurrentPhaseTimer).not.toHaveBeenCalled();
  });

  it('does not DM synthetic bottest wolves for no-consensus notifications', async () => {
    const services = {
      roomService: { getRoom: jest.fn() },
      orchestrator: {},
      nightActionService: {},
      timerService: {},
      dayService: {},
      storage: {},
    } as any;
    const bot = {
      on: jest.fn(),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;
    const controller = new GameFlowController(services, bot);
    const room = {
      id: 'room-bottest',
      chatId: 'chat1',
      currentRound: 1,
      players: {
        '9999999002': { telegramId: '9999999002', nickname: 'Bot Wolf 1', alive: true, role: RoleId.WEREWOLF },
        '9999999009': { telegramId: '9999999009', nickname: 'Bot Wolf 2', alive: true, role: RoleId.WEREWOLF },
        villager: { telegramId: 'villager', nickname: 'Villager', alive: true, role: RoleId.VILLAGER },
      },
      pendingNightActions: [
        { actorTelegramId: '9999999002', actionType: NightActionType.WEREWOLF_VOTE_KILL, round: 1, targetTelegramId: 'villager', actionId: 'a1' },
        { actorTelegramId: '9999999009', actionType: NightActionType.WEREWOLF_VOTE_KILL, round: 1, targetTelegramId: '9999999002', actionId: 'a2' },
      ],
    } as any;

    await (controller as any).notifyWerewolfNoConsensus(room);

    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a private notice to all werewolves when they fail to agree before the night timeout', async () => {
    const services = {
      roomService: { getRoom: jest.fn() },
      orchestrator: {},
      nightActionService: {},
      timerService: {},
      dayService: {},
      storage: {},
    } as any;

    const bot = {
      on: jest.fn(),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;

    const controller = new GameFlowController(services, bot);

    const room = {
      id: 'room1',
      chatId: 'chat1',
      currentRound: 1,
      players: {
        wolf1: { telegramId: 'wolf1', nickname: 'Wolf 1', alive: true, role: RoleId.WEREWOLF },
        wolf2: { telegramId: 'wolf2', nickname: 'Wolf 2', alive: true, role: RoleId.WEREWOLF },
        villager: { telegramId: 'villager', nickname: 'Villager', alive: true, role: RoleId.VILLAGER },
      },
      pendingNightActions: [
        { actorTelegramId: 'wolf1', actionType: NightActionType.WEREWOLF_VOTE_KILL, round: 1, targetTelegramId: 'villager', actionId: 'a1' },
        { actorTelegramId: 'wolf2', actionType: NightActionType.WEREWOLF_VOTE_KILL, round: 1, targetTelegramId: 'wolf1', actionId: 'a2' },
      ],
    } as any;

    await (controller as any).notifyWerewolfNoConsensus(room);

    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('wolf1', Messages.werewolfNoConsensusNotice(), { parse_mode: 'Markdown' });
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('wolf2', Messages.werewolfNoConsensusNotice(), { parse_mode: 'Markdown' });
  });
});


describe('GameFlowController Telegram failure isolation', () => {
  it('continues to discussion when the day announcement API call fails', async () => {
    const bot = {
      on: jest.fn(),
      telegram: { sendMessage: jest.fn().mockRejectedValue(new Error('telegram timeout')) },
    } as any;
    const controller = new GameFlowController({ storage: {}, redis: {} } as any, bot);
    const startDiscussion = jest.fn().mockResolvedValue(undefined);
    (controller as any).startDiscussion = startDiscussion;

    await controller.onNightResolved(
      {
        id: 'room1',
        chatId: 'chat1',
        currentRound: 1,
        gameState: GameState.DAY,
        players: {},
        silencedPlayerId: null,
      } as any,
      [],
      [],
    );

    expect(startDiscussion).toHaveBeenCalledWith('room1');
  });

  it('continues to the next night when execution presentation fails', async () => {
    const bot = {
      on: jest.fn(),
      telegram: { sendMessage: jest.fn().mockRejectedValue(new Error('telegram 500')) },
    } as any;
    const controller = new GameFlowController({ storage: {}, redis: {} } as any, bot);
    const startNightPrompts = jest.fn().mockResolvedValue(undefined);
    (controller as any).startNightPrompts = startNightPrompts;

    await controller.onExecutionResolved(
      {
        id: 'room1',
        chatId: 'chat1',
        currentRound: 1,
        gameState: GameState.NIGHT,
        players: {},
      } as any,
      null,
      [],
    );

    expect(startNightPrompts).toHaveBeenCalled();
  });
});


describe('GameFlowController restart/recovery paths', () => {
  it('reopens an incomplete discussion opening after controller recreation', async () => {
    const room = {
      id: 'room1',
      gameState: GameState.DISCUSSION,
      discussionLifecycle: 'OPENING',
      discussionEnforcementReady: false,
      discussionCycleId: 'cycle-1',
    } as any;
    const services = {
      roomService: { getRoom: jest.fn().mockResolvedValue(room) },
      storage: {},
      redis: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn() } } as any;
    const controller = new GameFlowController(services, bot);
    const activate = jest.fn().mockResolvedValue(undefined);
    (controller as any).activateDiscussionOpening = activate;

    await controller.resumeDiscussionOpening('room1');

    expect(activate).toHaveBeenCalledWith(room);
  });

  it('resolves an overdue voting phase after restart instead of reopening an old timer', async () => {
    const handlers = new Map<string, (roomId: string, payload: Record<string, unknown>) => Promise<void>>();
    const resolveExecution = jest.fn().mockResolvedValue(undefined);
    const services = {
      roomService: {
        getRoom: jest.fn().mockResolvedValue({
          id: 'room1',
          gameState: GameState.VOTING,
          currentRound: 3,
          ballotId: 'ballot-3',
        }),
      },
      timerService: {
        onTimeout: jest.fn((jobType: string, handler: (roomId: string, payload: Record<string, unknown>) => Promise<void>) => {
          handlers.set(jobType, handler);
        }),
      },
      orchestrator: {},
      storage: {},
      dayService: {},
      nightActionService: {},
      redis: {},
    } as any;
    const bot = { on: jest.fn(), telegram: { sendMessage: jest.fn() } } as any;
    const controller = new GameFlowController(services, bot);
    (controller as any).resolveExecution = resolveExecution;
    controller.registerTimeoutHandlers();

    await handlers.get(TimerJobType.VOTING_TIMEOUT)!('room1', {
      round: 3,
      ballotId: 'ballot-3',
    });

    expect(resolveExecution).toHaveBeenCalledWith('room1');
  });
});
