import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { translateError } from '../presenters/translateError';
import { GameState, RoomStatus, RoleId } from '../../engine/domain/enums';
import { logger } from '../../infrastructure/logging/logger';

const BOT_ID_PREFIX = '999999900';

function parseRoleAlias(token: string): RoleId | null {
  const normalized = token.toLowerCase();
  switch (normalized) {
    case 'soi':
      return RoleId.WEREWOLF;
    case 'tientri':
    case 'tientriy':
      return RoleId.SEER;
    case 'baove':
      return RoleId.BODYGUARD;
    case 'phuthuy':
      return RoleId.WITCH;
    case 'thosan':
      return RoleId.HUNTER;
    default:
      return null;
  }
}

export function registerbottestCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('bottest', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply('❌ Lệnh /bottest chỉ dùng được trong group chat.');
      return;
    }

    const roomId = String(ctx.chat.id);
    const hostTelegramId = String(ctx.from.id);
    const hostNickname = ctx.from.first_name ?? ctx.from.username ?? 'Host';

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    let targetPlayerCount = 6;
    let requestedRole: RoleId | null = null;

    if (args.length > 0) {
      const firstArg = args[0];
      const parsedCount = parseInt(firstArg, 10);
      if (!isNaN(parsedCount)) {
        if (parsedCount >= 4 && parsedCount <= 15) {
          targetPlayerCount = parsedCount;
        } else {
          await ctx.reply('⚠️ Số lượng người chơi cho phòng test phải từ 4 đến 15. Mặc định dùng 6.');
        }
        if (args[1]) {
          requestedRole = parseRoleAlias(args[1]);
        }
      } else {
        requestedRole = parseRoleAlias(firstArg);
        if (args[1]) {
          const parsedCountFromSecondArg = parseInt(args[1], 10);
          if (!isNaN(parsedCountFromSecondArg) && parsedCountFromSecondArg >= 4 && parsedCountFromSecondArg <= 15) {
            targetPlayerCount = parsedCountFromSecondArg;
          }
        }
      }
    }

    try {
      const existingRoom = await services.roomService.getRoom(roomId);
      if (existingRoom && existingRoom.status !== RoomStatus.CLOSED && existingRoom.gameState !== GameState.GAME_OVER) {
        await ctx.reply(
          '❌ Phòng hiện tại đang có ván chơi hoạt động. Vui lòng kết thúc ván hiện tại trước khi tạo phòng test.',
        );
        return;
      }

      logger.debug('bottest: creating test room', {
        roomId,
        hostTelegramId,
        requestedRole,
        targetPlayerCount,
      });

      await services.roomService.createRoom({
        roomId,
        hostTelegramId,
        hostNickname,
        chatId: roomId,
      });

      const requestedRoleOverride = requestedRole;

      const room = await services.roomService.getRoom(roomId);
      if (!room) {
        throw new Error('Không thể tạo phòng test.');
      }

      const existingCount = Object.keys(room.players).length;
      const needed = Math.max(0, targetPlayerCount - existingCount);

      await ctx.reply(`🎮 Phòng test đã được tạo. Đang thêm ${needed} bot để phòng có ${targetPlayerCount} người...`);

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

      if (requestedRoleOverride) {
        const roomWithOverride = await services.storage.getRoom(roomId);
        if (roomWithOverride) {
          logger.debug('bottest: persisting requested role override', {
            roomId,
            requestedRoleOverride,
            existingVersion: roomWithOverride.version,
          });
          await services.storage.saveRoom(
            { ...roomWithOverride, requestedRoleOverride: requestedRoleOverride },
            roomWithOverride.version,
          );
        }
      }
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}

