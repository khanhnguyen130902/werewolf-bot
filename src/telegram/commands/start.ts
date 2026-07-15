import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';

/**
 * /start handler. Its ONLY required job, per the confirmed UX rule, is to
 * record that this Telegram user can now be DMed by the bot -- Telegram
 * forbids a bot from proactively messaging a user until that user has sent
 * the bot at least one message (conventionally /start) in a private chat.
 *
 * This works in BOTH contexts:
 *   - Private chat (ctx.chat.type === 'private'): the normal case, this IS
 *     the DM the rule requires.
 *   - Group chat: some users may type /start in the group out of habit; we
 *     still greet them but explicit DM-reachability can only be established
 *     by a private-chat /start, so we remind them to DM the bot directly.
 */
export function registerStartCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    const telegramId = String(ctx.from?.id);
    const isPrivateChat = ctx.chat?.type === 'private';

    if (isPrivateChat) {
      await services.storage.markDmReachable(telegramId);
      await ctx.reply(
        '👋 Chào mừng đến với Ma Sói Bot!\n\n' +
          'Bạn đã sẵn sàng để tham gia các ván chơi. Hãy vào group chat và gõ /join khi Host đã tạo phòng.',
      );
    } else {
      await ctx.reply(
        '👋 Xin chào! Để có thể tham gia chơi, vui lòng nhắn /start cho bot ở tin nhắn riêng trước:\n' +
          `👉 https://t.me/${ctx.botInfo?.username}?start=hello`,
      );
    }
  });
}
