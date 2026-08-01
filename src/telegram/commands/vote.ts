import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { GameFlowController } from '../GameFlowController';
import { translateError } from '../presenters/translateError';

export function registerVoteCommand(
  _services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.command('vote', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/vote'));
      return;
    }

    const roomId = String(ctx.chat.id);

    try {
      await flowController.startVoting(roomId);
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
