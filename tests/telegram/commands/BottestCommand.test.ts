import { BotServices } from '../../../src/telegram/BotServices';
import { registerbottestCommand } from '../../../src/telegram/commands/bottest';
import { GameState, RoleId, RoomStatus } from '../../../src/engine/domain/enums';

describe('registerbottestCommand', () => {
  const handlers: Array<(ctx: any) => Promise<void>> = [];
  const bot = {
    command: (_name: string, handler: (ctx: any) => Promise<void>) => handlers.push(handler),
  } as any;

  beforeEach(() => {
    handlers.length = 0;
  });

  it('accepts Vietnamese role aliases, fills the requested count, and persists the override before ready', async () => {
    const roomAfterCreate = {
      id: 'room-1',
      hostTelegramId: '42',
      status: RoomStatus.OPEN,
      gameState: GameState.WAITING,
      players: {
        '42': { telegramId: '42', nickname: 'Host', alive: true },
      },
      version: 1,
    };
    const roomAfterJoin = {
      ...roomAfterCreate,
      players: Object.fromEntries([
        ['42', roomAfterCreate.players['42']],
        ...Array.from({ length: 7 }, (_, index) => [
          `999999900${index}`,
          { telegramId: `999999900${index}`, nickname: `Bot${index + 1}`, alive: true },
        ]),
      ]),
      version: 8,
    };
    const getRoom = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(roomAfterCreate)
      .mockResolvedValueOnce(roomAfterJoin);
    const saveRoom = jest.fn().mockResolvedValue({
      ...roomAfterJoin,
      requestedRoleOverride: RoleId.SEER,
      version: 9,
    });
    const services = {
      roomService: {
        getRoom,
        createRoom: jest.fn().mockResolvedValue(roomAfterCreate),
        joinRoom: jest.fn().mockResolvedValue(roomAfterJoin),
      },
      storage: {
        markDmReachable: jest.fn().mockResolvedValue(undefined),
        getRoom: jest.fn().mockResolvedValue(roomAfterJoin),
        saveRoom,
      },
    } as unknown as BotServices;
    registerbottestCommand(services, bot);

    const ctx = {
      chat: { type: 'group', id: 'room-1' },
      from: { id: 42, first_name: 'Host' },
      message: { text: '/bottest 8 tiên tri' },
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await handlers[0](ctx);

    expect(services.roomService.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-1',
      hostTelegramId: '42',
    }));
    expect(services.roomService.joinRoom).toHaveBeenCalledTimes(7);
    expect(saveRoom).toHaveBeenCalledWith(
      expect.objectContaining({ requestedRoleOverride: RoleId.SEER }),
      roomAfterJoin.version,
    );
    expect(ctx.reply).toHaveBeenLastCalledWith(
      expect.stringContaining('Phòng test sẵn sàng với 8 người chơi'),
    );
    expect(saveRoom.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.reply.mock.invocationCallOrder[ctx.reply.mock.invocationCallOrder.length - 1],
    );
  });

  it('rejects private-chat usage without touching room services', async () => {
    const services = {
      roomService: { getRoom: jest.fn(), createRoom: jest.fn(), joinRoom: jest.fn() },
      storage: { markDmReachable: jest.fn(), getRoom: jest.fn(), saveRoom: jest.fn() },
    } as unknown as BotServices;
    registerbottestCommand(services, bot);
    const ctx = {
      chat: { type: 'private', id: 'private-1' },
      from: { id: 42 },
      message: { text: '/bottest' },
      reply: jest.fn().mockResolvedValue(undefined),
    };

    await handlers[0](ctx);

    expect(ctx.reply).toHaveBeenCalled();
    expect(services.roomService.getRoom).not.toHaveBeenCalled();
  });
});
