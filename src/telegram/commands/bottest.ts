import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';
import { GameState, RoomStatus, RoleId } from '../../engine/domain/enums';
import { logger } from '../../infrastructure/logging/logger';
import { buildFullName } from '../utils/buildFullName';

const BOT_ID_PREFIX = '999999900';

function parseRoleAlias(token: string): RoleId | null {
  const normalized = token
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  switch (normalized) {
    case 'soi':
      return RoleId.WEREWOLF;
    case 'tientri':
    case 'tientriy':
    case 'seer':
      return RoleId.SEER;
    case 'baove':
    case 'bodyguard':
    case 'doctor':
      return RoleId.BODYGUARD;
    case 'phuthuy':
    case 'witch':
      return RoleId.WITCH;
    case 'thosan':
    case 'hunter':
      return RoleId.HUNTER;
    case 'phapsucam':
    case 'silentmage':
    case 'silentwizard':
      return RoleId.SILENT_MAGE;
    case 'danlang':
    case 'villager':
      return RoleId.VILLAGER;
    default:
      return null;
  }
}

export function registerbottestCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command(/^bottest$/i, async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/bottest'));
      return;
    }

    const roomId = String(ctx.chat.id);
    const hostTelegramId = String(ctx.from.id);
    const hostNickname = buildFullName(ctx.from, 'Host');

    const args = ctx.message.text.trim().split(/\s+/).slice(1);
    let targetPlayerCount = 6;
    let requestedRole: RoleId | null = null;

    if (args.length > 0) {
      const numericArgIndex = args.findIndex((token) => /^\d+$/.test(token));
      const roleTokens = numericArgIndex >= 0
        ? args.filter((_, index) => index !== numericArgIndex)
        : args;
      requestedRole = parseRoleAlias(roleTokens.join(''));

      if (numericArgIndex >= 0) {
        const parsedCount = Number(args[numericArgIndex]);
        if (parsedCount >= 4 && parsedCount <= 15) {
          targetPlayerCount = parsedCount;
        } else {
          await ctx.reply('⚠️ Số lượng người chơi cho phòng test phải từ 4 đến 15. Mặc định dùng 6.');
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

      await ctx.reply(`🤖 Phòng test đã được tạo. Đang thêm ${needed} bot để phòng có ${targetPlayerCount} người...`);

      for (let i = 0; i < needed; i += 1) {
        const botId = `${BOT_ID_PREFIX}${i}`;
        const botNickname = `Bot${i + 1}`;
        await services.storage.markDmReachable(botId);
        await services.roomService.joinRoom({ roomId, telegramId: botId, nickname: botNickname });
      }

      const updatedRoom = await services.roomService.getRoom(roomId);
      const finalCount = updatedRoom ? Object.keys(updatedRoom.players).length : existingCount;
      if (requestedRoleOverride) {
        const roomWithOverride = await services.storage.getRoom(roomId);
        if (roomWithOverride) {
          logger.debug('bottest: persisting requested role override', {
            roomId,
            requestedRoleOverride,
            existingVersion: roomWithOverride.version,
          });
          await services.storage.saveRoom(
            { ...roomWithOverride, requestedRoleOverride },
            roomWithOverride.version,
          );
        }
      }

      await ctx.reply(
        `✅ Phòng test sẵn sàng với ${finalCount} người chơi. Host gõ /startgame để bắt đầu.`,
      );
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}

