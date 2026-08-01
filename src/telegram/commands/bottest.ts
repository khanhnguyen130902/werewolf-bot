import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
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
      await ctx.reply(Messages.groupOnly('/bottest'));
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
          await ctx.reply('âš ï¸ Sá»‘ lÆ°á»£ng ngÆ°á»i chÆ¡i cho phÃ²ng test pháº£i tá»« 4 Ä‘áº¿n 15. Máº·c Ä‘á»‹nh dÃ¹ng 6.');
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
          'âŒ PhÃ²ng hiá»‡n táº¡i Ä‘ang cÃ³ vÃ¡n chÆ¡i hoáº¡t Ä‘á»™ng. Vui lÃ²ng káº¿t thÃºc vÃ¡n hiá»‡n táº¡i trÆ°á»›c khi táº¡o phÃ²ng test.',
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
        throw new Error('KhÃ´ng thá»ƒ táº¡o phÃ²ng test.');
      }

      const existingCount = Object.keys(room.players).length;
      const needed = Math.max(0, targetPlayerCount - existingCount);

      await ctx.reply(`ðŸŽ® PhÃ²ng test Ä‘Ã£ Ä‘Æ°á»£c táº¡o. Äang thÃªm ${needed} bot Ä‘á»ƒ phÃ²ng cÃ³ ${targetPlayerCount} ngÆ°á»i...`);

      for (let i = 0; i < needed; i += 1) {
        const botId = `${BOT_ID_PREFIX}${i}`;
        const botNickname = `Bot${i + 1}`;
        await services.storage.markDmReachable(botId);
        await services.roomService.joinRoom({ roomId, telegramId: botId, nickname: botNickname });
      }

      const updatedRoom = await services.roomService.getRoom(roomId);
      const finalCount = updatedRoom ? Object.keys(updatedRoom.players).length : existingCount;
      await ctx.reply(
        `âœ… PhÃ²ng test sáºµn sÃ ng vá»›i ${finalCount} ngÆ°á»i chÆ¡i. Host gÃµ /startgame Ä‘á»ƒ báº¯t Ä‘áº§u.`,
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

