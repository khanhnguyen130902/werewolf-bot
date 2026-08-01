import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';

export function registerEndCommand(services: BotServices, bot: Telegraf<BotContext>): void {
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
      await ctx.reply(Messages.roomClosed());
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
