import { registerVoteCommand } from '../../../src/telegram/commands/vote';
import { GameFlowController } from '../../../src/telegram/GameFlowController';
import { BotServices } from '../../../src/telegram/BotServices';
import { InvalidPhaseActionError } from '../../../src/engine/errors/DomainError';
import { GameState, RoomStatus } from '../../../src/engine/domain/enums';

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

  it('notifies a user outside the locked game when they use /vote', async () => {
    const startVoting = jest.fn();
    const flowController = { startVoting } as unknown as GameFlowController;
    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerVoteCommand({
      roomService: {
        getRoom: jest.fn().mockResolvedValue({
          status: RoomStatus.LOCKED,
          gameState: GameState.DISCUSSION,
          players: { 'participant-1': { telegramId: 'participant-1' } },
        }),
      },
    } as unknown as BotServices, flowController, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 'outsider-1' },
      reply: jest.fn(),
    };

    await registeredHandlers[0](ctx);

    expect(ctx.reply).toHaveBeenCalledWith('🚫 Bạn không tham gia ván chơi hiện tại nên không thể bỏ phiếu.');
    expect(startVoting).not.toHaveBeenCalled();
  });

  it('re-presents the active ballot when /vote is used after voting already started', async () => {
    const startVoting = jest.fn();
    const remindVoting = jest.fn().mockResolvedValue(true);
    const flowController = { startVoting, remindVoting } as unknown as GameFlowController;

    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerVoteCommand({
      roomService: {
        getRoom: jest.fn().mockResolvedValue({ gameState: GameState.VOTING, ballotId: 'b-current' }),
      },
    } as unknown as BotServices, flowController, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 'host-1' },
      reply: jest.fn(),
    };

    await registeredHandlers[0](ctx);

    expect(remindVoting).toHaveBeenCalledWith('room-1');
    expect(startVoting).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
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
