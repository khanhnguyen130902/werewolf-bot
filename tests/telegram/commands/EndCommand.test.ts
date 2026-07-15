import { registerEndCommand } from '../../../src/telegram/commands/end';
import { BotServices } from '../../../src/telegram/BotServices';

describe('registerEndCommand', () => {
  it('closes the current room when the host uses /end in a group', async () => {
    const closeRoom = jest.fn().mockResolvedValue(undefined);
    const services = { roomService: { closeRoom } } as unknown as BotServices;

    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerEndCommand(services, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 'host-1' },
      reply: jest.fn(),
    };

    await registeredHandlers[0](ctx);

    expect(closeRoom).toHaveBeenCalledWith({
      roomId: 'room-1',
      hostTelegramId: 'host-1',
      reason: 'host-ended-room',
    });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('đã bị đóng'));
  });
});
