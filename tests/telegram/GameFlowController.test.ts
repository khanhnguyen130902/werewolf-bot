import { GameFlowController } from '../../src/telegram/GameFlowController';
import { Messages } from '../../src/telegram/presenters/messages';
import { NightActionType, RoleId } from '../../src/engine/domain/enums';

describe('GameFlowController', () => {
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
