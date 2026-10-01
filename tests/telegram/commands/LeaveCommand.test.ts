import { LeaveNotAllowedError } from '../../../src/engine/errors/DomainError';
import { Messages } from '../../../src/telegram/presenters/messages';
import { registerLeaveCommand } from '../../../src/telegram/commands/leave';

describe('/leave policy', () => {
  function captureHandler() {
    let handler: ((ctx: any) => Promise<void>) | undefined;
    const bot = {
      command: jest.fn((_matcher: unknown, callback: (ctx: any) => Promise<void>) => {
        handler = callback;
      }),
    } as any;
    return { bot, getHandler: () => handler! };
  }

  it('removes a regular player from a waiting room', async () => {
    const leaveRoom = jest.fn().mockResolvedValue({ room: {}, roomClosed: false });
    const { bot, getHandler } = captureHandler();
    registerLeaveCommand({ roomService: { leaveRoom } } as any, bot);
    const reply = jest.fn().mockResolvedValue(undefined);

    await getHandler()({
      chat: { type: 'group', id: 123 },
      from: { id: 456, first_name: 'Alice' },
      reply,
    });

    expect(leaveRoom).toHaveBeenCalledWith({ roomId: '123', telegramId: '456' });
    expect(reply).toHaveBeenCalledWith(Messages.left('Alice'));
  });

  it('closes the waiting room when the Host leaves', async () => {
    const leaveRoom = jest.fn().mockResolvedValue({ room: { status: 'CLOSED' }, roomClosed: true });
    const { bot, getHandler } = captureHandler();
    registerLeaveCommand({ roomService: { leaveRoom } } as any, bot);
    const reply = jest.fn().mockResolvedValue(undefined);

    await getHandler()({
      chat: { type: 'group', id: 123 },
      from: { id: 456, first_name: 'Host' },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(Messages.hostLeftWaitingRoom());
  });

  it('rejects leave after the match has started', async () => {
    const leaveRoom = jest.fn().mockRejectedValue(new LeaveNotAllowedError('NIGHT'));
    const { bot, getHandler } = captureHandler();
    registerLeaveCommand({ roomService: { leaveRoom } } as any, bot);
    const reply = jest.fn().mockResolvedValue(undefined);

    await getHandler()({
      chat: { type: 'group', id: 123 },
      from: { id: 456, first_name: 'Alice' },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(Messages.leaveNotAllowed());
  });

  it('rejects `/leave` in a private chat without touching the room service', async () => {
    const leaveRoom = jest.fn();
    const { bot, getHandler } = captureHandler();
    registerLeaveCommand({ roomService: { leaveRoom } } as any, bot);
    const reply = jest.fn().mockResolvedValue(undefined);

    await getHandler()({
      chat: { type: 'private', id: 123 },
      from: { id: 456, first_name: 'Alice' },
      reply,
    });

    expect(leaveRoom).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(Messages.groupOnly('/leave'));
  });
});
