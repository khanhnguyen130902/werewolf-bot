import { registerVoteCommand } from '../../../src/telegram/commands/vote';
import { GameFlowController } from '../../../src/telegram/GameFlowController';
import { BotServices } from '../../../src/telegram/BotServices';
import { InvalidPhaseActionError } from '../../../src/engine/errors/DomainError';

describe('registerVoteCommand', () => {
  it('starts voting immediately when the host uses /vote in a group', async () => {
    const startVoting = jest.fn().mockResolvedValue(undefined);
    const flowController = { startVoting } as unknown as GameFlowController;

    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerVoteCommand({} as BotServices, flowController, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 'host-1' },
      reply: jest.fn(),
    };

    await registeredHandlers[0](ctx);

    expect(startVoting).toHaveBeenCalledWith('room-1');
  });

  it('replies with a friendly message when /vote is used at the wrong phase', async () => {
    const startVoting = jest.fn().mockRejectedValue(new InvalidPhaseActionError('VOTE', 'DISCUSSION'));
    const flowController = { startVoting } as unknown as GameFlowController;

    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerVoteCommand({} as BotServices, flowController, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 'host-1' },
      reply: jest.fn(),
    };

    await registeredHandlers[0](ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('giai đoạn'));
  });
});
