import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { GameState } from '../../engine/domain/enums';
import { translateError } from '../presenters/translateError';

const STATE_LABELS: Record<string, string> = {
  [GameState.WAITING]: 'Äang chá» ngÆ°á»i chÆ¡i',
  [GameState.STARTING]: 'Äang khá»Ÿi Ä‘á»™ng vÃ¡n chÆ¡i',
  [GameState.FIRST_NIGHT]: 'ÄÃªm Ä‘áº§u tiÃªn',
  [GameState.NIGHT]: 'Ban Ä‘Ãªm',
  [GameState.DAY]: 'Ban ngÃ y',
  [GameState.DISCUSSION]: 'Äang tháº£o luáº­n',
  [GameState.VOTING]: 'Äang bá» phiáº¿u',
  [GameState.EXECUTION]: 'Äang xá»­ tá»­',
  [GameState.CHECK_WIN]: 'Äang kiá»ƒm tra káº¿t quáº£',
  [GameState.GAME_OVER]: 'VÃ¡n Ä‘Ã£ káº¿t thÃºc',
};

export function registerStatusCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('status', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/status'));
      return;
    }

    const roomId = String(ctx.chat.id);
    try {
      const room = await services.roomService.getRoom(roomId);
      if (!room) {
        await ctx.reply('ChÆ°a cÃ³ phÃ²ng chÆ¡i nÃ o á»Ÿ Ä‘Ã¢y. GÃµ /create Ä‘á»ƒ táº¡o phÃ²ng má»›i.');
        return;
      }

      const players = Object.values(room.players);
      const alivePlayers = players.filter((p) => p.alive);
      const playerList = players
        .map((p) => `${p.alive ? 'ðŸŸ¢' : 'âš«'} ${p.nickname}${p.isHost ? ' (Host)' : ''}`)
        .join('\n');

      const remainingMs = await services.timerService.getRemainingMs(roomId);
      const remainingText =
        remainingMs !== null && remainingMs > 0
          ? `\nâ± CÃ²n láº¡i: ${Math.ceil(remainingMs / 1000)} giÃ¢y`
          : '';

      await ctx.reply(
        `ðŸ“Š Tráº¡ng thÃ¡i phÃ²ng:\n\n` +
          `Giai Ä‘oáº¡n: **${STATE_LABELS[room.gameState] ?? room.gameState}**\n` +
          `VÃ²ng: ${room.currentRound}\n` +
          `NgÆ°á»i chÆ¡i (${alivePlayers.length}/${players.length} cÃ²n sá»‘ng):\n${playerList}` +
          remainingText,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply(translateError(err));
    }
  });
}
