import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { GameState, RoomStatus } from '../../engine/domain/enums';
import { translateError } from '../presenters/translateError';
import { logger } from '../../infrastructure/logging/logger';

const STATE_LABELS: Record<string, string> = {
  [GameState.WAITING]: 'Đang chờ người chơi',
  [GameState.STARTING]: 'Đang khởi động ván chơi',
  [GameState.FIRST_NIGHT]: 'Đêm đầu tiên',
  [GameState.NIGHT]: 'Ban đêm',
  [GameState.DAY]: 'Ban ngày',
  [GameState.DISCUSSION]: 'Đang thảo luận',
  [GameState.VOTING]: 'Đang bỏ phiếu',
  [GameState.EXECUTION]: 'Đang xử lý',
  [GameState.CHECK_WIN]: 'Đang kiểm tra kết quả',
  [GameState.GAME_OVER]: 'Ván đã kết thúc',
};

export function registerStatusCommand(services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('status', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/status'));
      return;
    }

    const roomId = String(ctx.chat.id);
    logger.info('Command /status received', { roomId, userId: String(ctx.from?.id ?? 'unknown') });
    try {
      const room = await services.roomService.getRoom(roomId);
      if (!room || room.gameState === GameState.GAME_OVER || room.status === RoomStatus.CLOSED) {
        await ctx.reply(Messages.noActiveGame());
        return;
      }

      const players = Object.values(room.players);
      const alivePlayers = players.filter((p) => p.alive);
      const playerList = players
        .map((p) => `${p.alive ? '🟢' : '🔴'} ${p.nickname}${p.isHost ? ' (Host)' : ''}`)
        .join('\n');

      const remainingMs = await services.timerService.getRemainingMs(roomId);
      const remainingText =
        remainingMs !== null && remainingMs > 0
          ? `\n⏱ Còn lại: ${Math.ceil(remainingMs / 1000)} giây`
          : '';

      await ctx.reply(
        `📊 Trạng thái phòng:\n\n` +
          `Giai đoạn: **${STATE_LABELS[room.gameState] ?? room.gameState}**\n` +
          `Vòng: ${room.currentRound}\n` +
          `Người chơi (${alivePlayers.length}/${players.length} còn sống):\n${playerList}` +
          remainingText,
        { parse_mode: 'Markdown' },
      );
      logger.info('Command /status completed', { roomId, gameState: room.gameState });
    } catch (err) {
      logger.error('Command /status failed', { roomId, err });
      await ctx.reply(translateError(err));
    }
  });
}
