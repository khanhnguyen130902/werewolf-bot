import { GameFlowController } from '../../src/telegram/GameFlowController';
import { Messages } from '../../src/telegram/presenters/messages';
import { NightActionType, RoleId } from '../../src/engine/domain/enums';

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
