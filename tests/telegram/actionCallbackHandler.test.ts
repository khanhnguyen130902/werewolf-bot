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
  it('answers the callback immediately for vote actions before the submission finishes', async () => {
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
    } as any;

    registerActionCallbackHandler(services, flowController, bot);

    const deferred = createDeferred<void>();
    services.dayService.submitVote.mockImplementation(() => deferred.promise);

    const answerCbQuery = jest.fn().mockResolvedValue(undefined);
    const ctx = {
      callbackQuery: { data: 'action:VOTE:target1' },
      from: { id: '123' },
      answerCbQuery,
      telegram: { sendMessage: jest.fn() },
    } as any;
    const next = jest.fn();

    const runPromise = capturedHandler!(ctx, next);

    expect(answerCbQuery).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    deferred.resolve(undefined);
    await runPromise;
  });
});
