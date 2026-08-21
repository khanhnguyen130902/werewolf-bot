import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';

/**
 * Stable, mobile-friendly onboarding copy for the Telegram help command.
 * Keep this plain-text and below Telegram's message limit so it renders
 * consistently across clients without relying on parse-mode escaping.
 */
export const HELP_TEXT = [
  '🐺 WEREWOLF BOT',
  'Trợ lý điều hành game Ma Sói trên Telegram',
  '━━━━━━━━━━━━━━━━━━',
  '',
  '🚀 BẮT ĐẦU NHANH',
  '1. Nhắn /start cho bot trong tin nhắn riêng.',
  '2. Trong group, host dùng /create để mở phòng.',
  '3. Người chơi dùng /join để tham gia.',
  '4. Host dùng /startgame khi đã đủ người.',
  '5. Làm theo nút hành động bot gửi trong DM.',
  '',
  '🎮 LỆNH NGƯỜI CHƠI',
  '/start — Kích hoạt DM để nhận role và thông báo riêng.',
  '/join — Tham gia phòng đang mở trong group.',
  '/leave — Rời phòng trước khi ván bắt đầu.',
  '/status — Xem trạng thái phòng và số người chơi.',
  '/vote — Gửi phiếu thủ công khi cần.',
  '',
  '👑 LỆNH HOST',
  '/create — Tạo phòng mới trong group.',
  '/startgame — Khóa phòng và bắt đầu ván.',
  '/end — Kết thúc phòng hiện tại.',
  '',
  '🧪 KIỂM THỬ',
  '/bottest — Tạo phòng test với bot tự động.',
  'Chỉ dùng trong group development, không dùng ở production.',
  '',
  '🌙 CÁCH CHƠI',
  '• Ban đêm: role đặc biệt chọn hành động qua nút trong DM.',
  '• Ban ngày: mọi người thảo luận và bỏ phiếu trong group.',
  '• Người chết: không tiếp tục hành động hoặc tiết lộ role.',
  '• Ván kết thúc khi một phe đạt điều kiện chiến thắng.',
  '',
  '🔒 QUY TẮC QUAN TRỌNG',
  '• Luôn nhắn /start cho bot trước khi tham gia phòng.',
  '• Chỉ host mới được bắt đầu hoặc kết thúc ván.',
  '• Không chia sẻ role và nội dung DM vào group.',
  '• Nếu chưa tạo game, /join sẽ báo phòng chưa tồn tại.',
  '',
  '💡 CẦN TRỢ GIÚP?',
  'Dùng /help bất cứ lúc nào để mở lại hướng dẫn này.',
].join('\n');

export function registerHelpCommand(_services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
