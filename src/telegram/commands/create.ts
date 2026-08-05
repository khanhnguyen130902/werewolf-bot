import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';
import { GameFlowController } from '../GameFlowController';
import { buildFullName } from '../utils/buildFullName';

/**
 * /create handler. Confirmed UX rule: the room IS the existing group chat
 * the Host runs this command in (not a bot-created group) -- so `roomId`
 * is simply the Telegram chat id, and `chatId` on RoomState is the same
 * value. This keeps the mapping between "a Werewolf room" and "a Telegram
 * group" 1:1 and trivial to reason about.
 */
export function registerCreateCommand(
  services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.command('create', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/create'));
      return;
    }

    const hostTelegramId = String(ctx.from.id);
    const roomId = String(ctx.chat.id);
    const hostNickname = buildFullName(ctx.from, 'Host');

    try {
      // Safety cleanup: unmute anyone left muted from previous sessions
      await flowController.unmuteAllPlayers(roomId);

      await services.roomService.createRoom({
        roomId,
        hostTelegramId,
        hostNickname,
        chatId: roomId,
      });
      await ctx.reply(Messages.roomCreated(roomId));
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
