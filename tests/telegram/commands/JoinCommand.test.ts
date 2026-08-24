import { registerJoinCommand } from '../../../src/telegram/commands/join';
import { DmNotReachableError, RoomLockedError, RoomNotFoundError } from '../../../src/engine/errors/DomainError';
import { CANONICAL_MESSAGES } from '../../../src/telegram/presenters/canonicalContent';
import { Messages } from '../../../src/telegram/presenters/messages';

describe('/join command', () => {
  function setup(joinRoom: jest.Mock) {
    const handlers: Record<string, (ctx: any) => Promise<void>> = {};
    const bot = {
      command: jest.fn((name: string, handler: (ctx: any) => Promise<void>) => {
        handlers[name] = handler;
      }),
    } as any;
    registerJoinCommand({ roomService: { joinRoom } } as any, bot);
    return handlers.join;
  }

  function context() {
    return {
      chat: { id: '-100123', type: 'supergroup' },
      from: { id: 42, first_name: 'Test', last_name: 'User', username: 'tester' },
      botInfo: { username: 'werewolf_test_bot' },
      reply: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('returns the room-not-found message when the group has not created a game', async () => {
    const handler = setup(jest.fn().mockRejectedValue(new RoomNotFoundError('-100123')));
    const ctx = context();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(CANONICAL_MESSAGES.ROOM_NOT_CREATED.text);
  });

  it('does not let DM reachability mask a missing room', async () => {
    const handler = setup(jest.fn().mockRejectedValue(new RoomNotFoundError('-100123')));
    const replies = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const ctx = context();
      await handler(ctx);
      replies.add(ctx.reply.mock.calls[0][0]);
    }
    expect(replies).toEqual(new Set([CANONICAL_MESSAGES.ROOM_NOT_CREATED.text]));
  });

  it('keeps the locked-room message when a room exists but the game has started', async () => {
    const handler = setup(jest.fn().mockRejectedValue(new RoomLockedError('-100123')));
    const ctx = context();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith('🔒 Cánh cửa làng đã đóng. Ván chơi đã bắt đầu nên không thể tham gia thêm.');
  });

  it('still returns the DM prerequisite when a room exists but the player has not opened a DM', async () => {
    const handler = setup(jest.fn().mockRejectedValue(new DmNotReachableError('42')));
    const ctx = context();
    await handler(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(Messages.needDmFirst('werewolf_test_bot'));
  });
});
