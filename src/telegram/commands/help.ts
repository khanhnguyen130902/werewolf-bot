import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';

export function registerHelpCommand(_services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('help', async (ctx) => {
    const helpText = [
      '📖 Các lệnh hiện có:',
      '',
      '/start - Khởi tạo bot để nhận tin nhắn riêng',
      '/create - Tạo phòng chơi mới',
      '/join - Tham gia phòng bằng mã phòng',
      '/leave - Rời phòng hiện tại',
      '/status - Xem trạng thái phòng',
      '/startgame - Host bắt đầu ván chơi',
      '/vote - Gửi phiếu bầu thủ công (nếu cần)',
      '/end - Kết thúc phòng chơi',
      '/help - Xem danh sách lệnh',
      '',
      '💡 Gợi ý: hãy dùng bot ở tin nhắn riêng trước khi tham gia phòng để nhận vai trò và thông báo riêng.',
    ].join('\n');

    await ctx.reply(helpText);
  });
}
