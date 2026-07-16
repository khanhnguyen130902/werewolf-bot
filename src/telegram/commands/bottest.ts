import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { translateError } from '../presenters/translateError';
import { GameState, RoomStatus } from '../../engine/domain/enums';

const TEST_BOT_COUNT = 5;
const BOT_ID_PREFIX = '999999900';

export function registerbottestCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('bottest', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ Lệnh /bottest chỉ dùng được trong group chat.');
      return;
    }

    const roomId = String(ctx.chat.id);
    const hostTelegramId = String(ctx.from.id);
    const hostNickname = ctx.from.first_name ?? ctx.from.username ?? 'Host';

    try {
      const existingRoom = await services.roomService.getRoom(roomId);
      if (existingRoom && existingRoom.status !== RoomStatus.CLOSED && existingRoom.gameState !== GameState.GAME_OVER) {
        await ctx.reply(
          '❌ Phòng hiện tại đang có ván chơi hoạt động. Vui lòng kết thúc ván hiện tại trước khi tạo phòng test.',
        );
        return;
      }

      await services.roomService.createRoom({
        roomId,
        hostTelegramId,
        hostNickname,
        chatId: roomId,
      });

      await ctx.reply(`🎮 Phòng test đã được tạo. Đang thêm ${TEST_BOT_COUNT} bot để đủ người...`);

      const room = await services.roomService.getRoom(roomId);
      if (!room) {
        throw new Error('Không thể tạo phòng test.');
      }

      const existingCount = Object.keys(room.players).length;
      const needed = Math.max(0, 6 - existingCount);
      for (let i = 0; i < needed; i += 1) {
        const botId = `${BOT_ID_PREFIX}${i}`;
        const botNickname = `Bot${i + 1}`;
        await services.storage.markDmReachable(botId);
        await services.roomService.joinRoom({ roomId, telegramId: botId, nickname: botNickname });
      }

      const updatedRoom = await services.roomService.getRoom(roomId);
      const finalCount = updatedRoom ? Object.keys(updatedRoom.players).length : existingCount;
      await ctx.reply(
        `✅ Phòng test sẵn sàng với ${finalCount} người chơi. Host gõ /startgame để bắt đầu.`,
      );
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
