import { registerEndCommand } from '../../../src/telegram/commands/end';
import { BotServices } from '../../../src/telegram/BotServices';

describe('registerEndCommand', () => {
  it('closes the current room when the host uses /end in a group', async () => {
    const closeRoom = jest.fn().mockResolvedValue(undefined);
    const services = { roomService: { closeRoom } } as unknown as BotServices;

    const unmuteAllPlayers = jest.fn().mockResolvedValue(undefined);
    const flowController = { unmuteAllPlayers } as any;

    const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
    const bot = {
      command: (_name: string, handler: (ctx: any) => Promise<void>) => {
        registeredHandlers.push(handler);
      },
    } as any;

    registerEndCommand(services, flowController, bot);

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
    expect(unmuteAllPlayers).toHaveBeenCalledWith('room-1');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('khép lại'));
  });
});
