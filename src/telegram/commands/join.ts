import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';
import { DmNotReachableError } from '../../engine/errors/DomainError';

export function registerJoinCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('join', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ Lệnh /join chỉ dùng được trong group chat.');
      return;
    }

    const telegramId = String(ctx.from.id);
    const roomId = String(ctx.chat.id);
    const nickname = ctx.from.first_name ?? ctx.from.username ?? 'Player';

    try {
      const room = await services.roomService.joinRoom({ roomId, telegramId, nickname });
      await ctx.reply(Messages.joined(nickname, Object.keys(room.players).length));
    } catch (err) {
      if (err instanceof DmNotReachableError) {
        await ctx.reply(Messages.needDmFirst(ctx.botInfo?.username ?? ''));
        return;
      }
      await ctx.reply(translateError(err));
    }
  });
}
