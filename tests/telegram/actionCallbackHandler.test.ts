import { registerActionCallbackHandler } from '../../src/telegram/handlers/actionCallbackHandler';
import { Messages } from '../../src/telegram/presenters/messages';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('registerActionCallbackHandler', () => {
  it('confirms a vote action after the submission finishes', async () => {
    const services = {
      storage: {
        getPlayerSession: jest.fn().mockResolvedValue('room1'),
      },
      dayService: {
        submitVote: jest.fn(),
      },
      nightActionService: {
        submitNightAction: jest.fn(),
      },
      orchestrator: {
        allNightActionsSubmitted: jest.fn(),
      },
    } as any;

    const flowController = {
      promptWitchSaveForVictim: jest.fn(),
      onNightResolved: jest.fn(),
    } as any;

    let capturedHandler: ((ctx: any, next: any) => Promise<void>) | undefined;
    const bot = {
      on: jest.fn((_event: string, handler: (ctx: any, next: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;

    registerActionCallbackHandler(services, flowController, bot);

    services.dayService.submitVote.mockResolvedValue({
      players: {
        target1: {
          telegramId: 'target1',
          nickname: 'Target One',
          alive: true,
          hasVotedThisRound: false,
          voteTarget: null,
        },
        voter: {
          telegramId: '123',
          nickname: 'Voter',
          alive: true,
          hasVotedThisRound: true,
          voteTarget: 'target1',
        },
      },
    });

    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: 'action:VOTE:target1' },
      from: { id: '123' },
      answerCbQuery,
      editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      telegram: { sendMessage: jest.fn() },
    } as any;
    const next = jest.fn();

    await capturedHandler!(ctx, next);

    expect(services.dayService.submitVote).toHaveBeenCalled();
    expect(answerCbQuery).toHaveBeenCalledWith(Messages.voteRecorded());
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith(
      expect.objectContaining({
        inline_keyboard: expect.any(Array),
      }),
    );
    expect(ctx.reply).toHaveBeenCalledWith('✅ Bạn đã bỏ phiếu cho: **Target One**.');
    expect(next).not.toHaveBeenCalled();
  });

  it('confirms a night action after submission instead of leaving the UI stuck in processing', async () => {
    const services = {
      storage: {
        getPlayerSession: jest.fn().mockResolvedValue('room1'),
      },
      dayService: {
        submitVote: jest.fn(),
      },
      nightActionService: {
        submitNightAction: jest.fn().mockResolvedValue({
          players: {
            '123': {
              telegramId: '123',
              nickname: 'Wolf A',
              role: 'WEREWOLF',
              alive: true,
            },
          },
          pendingNightActions: [],
          currentRound: 1,
        }),
      },
      orchestrator: {
        allNightActionsSubmitted: jest.fn().mockResolvedValue(false),
        resolveNight: jest.fn(),
      },
    } as any;

    const flowController = {
      promptWitchSaveForVictim: jest.fn(),
      onNightResolved: jest.fn(),
    } as any;

    let capturedHandler: ((ctx: any, next: any) => Promise<void>) | undefined;
    const bot = {
      on: jest.fn((_event: string, handler: (ctx: any, next: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;

    registerActionCallbackHandler(services, flowController, bot);

    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: 'action:WEREWOLF_VOTE_KILL:target1' },
      from: { id: '123' },
      answerCbQuery,
      editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      telegram: { sendMessage: jest.fn() },
    } as any;
    const next = jest.fn();

    await capturedHandler!(ctx, next);

    expect(services.nightActionService.submitNightAction).toHaveBeenCalled();
    expect(answerCbQuery).toHaveBeenCalledWith('Đã ghi nhận hành động.');
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [] });
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith('123', '✅ Bạn chọn cắn: **target1**.');
    expect(next).not.toHaveBeenCalled();
  });

  it('passes hunter-shot callbacks through to next() since they use a different prefix', async () => {
    // hunter-shot:X:Y callbacks are handled by GameFlowController.registerHunterCallbackHandler,
    // NOT by registerActionCallbackHandler (which only handles "action:TYPE:TARGET" format).
    // This test verifies the handler correctly passes unrecognised callbacks to next().
    const services = {
      storage: { getPlayerSession: jest.fn() },
      dayService: { submitVote: jest.fn() },
      nightActionService: { submitNightAction: jest.fn() },
      orchestrator: { allNightActionsSubmitted: jest.fn() },
    } as any;

    const flowController = {
      promptWitchSaveForVictim: jest.fn(),
      onNightResolved: jest.fn(),
    } as any;

    let capturedHandler: ((ctx: any, next: any) => Promise<void>) | undefined;
    const bot = {
      on: jest.fn((_event: string, handler: (ctx: any, next: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;

    registerActionCallbackHandler(services, flowController, bot);

    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: 'hunter-shot:hunter1:victim1' },
      from: { id: 'hunter1' },
      answerCbQuery,
      editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      telegram: { sendMessage: jest.fn() },
    } as any;
    const next = jest.fn();

    await capturedHandler!(ctx, next);

    // hunter-shot format is not recognised by parseActionCallbackData → handler calls next()
    expect(next).toHaveBeenCalled();
    // No submission or UI changes should occur here
    expect(services.nightActionService.submitNightAction).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it('notifies werewolves of current choices after a werewolf vote', async () => {
    const services = {
      storage: {
        getPlayerSession: jest.fn().mockResolvedValue('room1'),
      },
      dayService: {
        submitVote: jest.fn(),
      },
      nightActionService: {
        submitNightAction: jest.fn().mockResolvedValue({
          players: {
            'wolf1': { telegramId: 'wolf1', nickname: 'Wolf A', role: 'WEREWOLF', alive: true },
            'wolf2': { telegramId: 'wolf2', nickname: 'Wolf B', role: 'WEREWOLF', alive: true },
            'villager1': { telegramId: 'villager1', nickname: 'Villager', role: 'VILLAGER', alive: true },
          },
          pendingNightActions: [
            {
              actorTelegramId: 'wolf1',
              actionType: 'WEREWOLF_VOTE_KILL',
              targetTelegramId: 'villager1',
              round: 1,
              actionId: 'action1',
            },
          ],
          currentRound: 1,
        }),
      },
      orchestrator: {
        allNightActionsSubmitted: jest.fn().mockResolvedValue(false),
      },
    } as any;

    const flowController = {
      promptWitchSaveForVictim: jest.fn(),
      onNightResolved: jest.fn(),
    } as any;

    let capturedHandler: ((ctx: any, next: any) => Promise<void>) | undefined;
    const bot = {
      on: jest.fn((_event: string, handler: (ctx: any, next: any) => Promise<void>) => {
        capturedHandler = handler;
      }),
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    } as any;

    registerActionCallbackHandler(services, flowController, bot);

    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: 'action:WEREWOLF_VOTE_KILL:villager1' },
      from: { id: 'wolf1' },
      answerCbQuery,
      editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      telegram: { sendMessage: jest.fn() },
    } as any;
    const next = jest.fn();

    await capturedHandler!(ctx, next);

    expect(services.nightActionService.submitNightAction).toHaveBeenCalled();
    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(3);
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      'wolf1',
      expect.stringContaining('- Wolf A: Villager'),
    );
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      'wolf2',
      expect.stringContaining('Wolf B: chưa chọn'),
    );
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      'wolf1',
      '✅ Bạn chọn cắn: **Villager**.',
    );
  });
});
