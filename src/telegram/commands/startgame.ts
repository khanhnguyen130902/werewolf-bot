import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { GameFlowController } from '../GameFlowController';
import { translateError } from '../presenters/translateError';

export function registerStartGameCommand(
  services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.command(/^startgame$/i, async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/startgame'));
      return;
    }

    const requestedByTelegramId = String(ctx.from.id);
    const roomId = String(ctx.chat.id);

    try {
      const room = await services.gameService.startGame({
        roomId,
        requestedByTelegramId,
      });
      await flowController.onGameStarted(room);
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
