import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { translateError } from '../presenters/translateError';

export function registerEndCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('end', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ Lệnh /end chỉ dùng được trong group chat.');
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
      await ctx.reply('🛑 Phòng hiện tại đã bị đóng. Bạn có thể tạo phòng mới trong nhóm này.');
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
