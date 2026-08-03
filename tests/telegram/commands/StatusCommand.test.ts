import { GameState, RoomStatus } from '../../../src/engine/domain/enums';
import { BotServices } from '../../../src/telegram/BotServices';
import { registerStatusCommand } from '../../../src/telegram/commands/status';
import { Messages } from '../../../src/telegram/presenters/messages';

describe('registerStatusCommand', () => {
  const registeredHandlers: Array<(ctx: any) => Promise<void>> = [];
  const bot = {
    command: (_name: string, handler: (ctx: any) => Promise<void>) => registeredHandlers.push(handler),
  } as any;

  const createContext = () => ({
    chat: { type: 'group', id: 'room-1' },
    reply: jest.fn(),
  });

  beforeEach(() => {
    registeredHandlers.length = 0;
  });

  it('shows the no-active-game notice when no room exists', async () => {
    const services = {
      roomService: { getRoom: jest.fn().mockResolvedValue(null) },
    } as unknown as BotServices;
    registerStatusCommand(services, bot);
    const ctx = createContext();

    await registeredHandlers[0](ctx);

    expect(ctx.reply).toHaveBeenCalledWith(Messages.noActiveGame());
  });

  it('shows the no-active-game notice after a game has ended', async () => {
    const services = {
      roomService: {
        getRoom: jest.fn().mockResolvedValue({
          gameState: GameState.GAME_OVER,
          status: RoomStatus.LOCKED,
        }),
      },
    } as unknown as BotServices;
    registerStatusCommand(services, bot);
    const ctx = createContext();

    await registeredHandlers[0](ctx);

    expect(ctx.reply).toHaveBeenCalledWith(Messages.noActiveGame());
  });
});
