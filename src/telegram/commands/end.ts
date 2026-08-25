import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';
import { GameFlowController } from '../GameFlowController';

export function registerEndCommand(
  services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.command('end', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/end'));
      return;
    }

    const hostTelegramId = String(ctx.from.id);
    const roomId = String(ctx.chat.id);

    try {
      await services.roomService.closeRoom({
        roomId,
        hostTelegramId,
        reason: 'host-ended-room',
      });
      await flowController.unmuteAllPlayers(roomId, { clearFallbackOnFailure: true });
      await ctx.reply(Messages.roomClosed());
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
