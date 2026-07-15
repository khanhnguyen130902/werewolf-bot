import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';

export function registerLeaveCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('leave', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ Lệnh /leave chỉ dùng được trong group chat.');
      return;
    }

    const telegramId = String(ctx.from.id);
    const roomId = String(ctx.chat.id);
    const nickname = ctx.from.first_name ?? ctx.from.username ?? 'Player';

    try {
      await services.roomService.leaveRoom({ roomId, telegramId });
      await ctx.reply(Messages.left(nickname));
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
