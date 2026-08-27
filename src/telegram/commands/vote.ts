import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { Messages } from '../presenters/messages';
import { GameState, RoomStatus } from '../../engine/domain/enums';
import { GameFlowController } from '../GameFlowController';
import { translateError } from '../presenters/translateError';
import { DomainError } from '../../engine/errors/DomainError';
import { logger } from '../../infrastructure/logging/logger';

export function registerVoteCommand(
  _services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.command(/^vote$/i, async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(Messages.groupOnly('/vote'));
      return;
    }

    const roomId = String(ctx.chat.id);
    logger.info('Command /vote received', { roomId, userId: String(ctx.from?.id ?? 'unknown') });

    try {
      const currentRoom = _services.roomService
        ? await _services.roomService.getRoom(roomId)
        : null;
      const userId = String(ctx.from?.id ?? '');
      if (currentRoom?.status === RoomStatus.LOCKED && !currentRoom.players[userId]) {
        await ctx.reply(Messages.notInCurrentGame());
        logger.info('Command /vote rejected because user is not in current game', {
          roomId,
          userId,
        });
        return;
      }

      if (currentRoom?.gameState === GameState.VOTING) {
        await flowController.remindVoting(roomId);
        logger.info('Command /vote re-presented active ballot', {
          roomId,
          ballotId: currentRoom.ballotId,
        });
        return;
      }

      await flowController.startVoting(roomId);
      logger.info('Command /vote completed', { roomId });
    } catch (err) {
      const isExpectedPhaseGuard = err instanceof DomainError && err.code === 'INVALID_PHASE_ACTION';
      if (isExpectedPhaseGuard) {
        logger.warn('Command /vote rejected by phase guard', { roomId, err });
      } else {
        logger.error('Command /vote failed', { roomId, err });
      }
      const message = isExpectedPhaseGuard
        ? '🗳️ Chưa thể mở voting: Phòng chưa ở giai đoạn bỏ phiếu.'
        : translateError(err);
      await ctx.reply(message);
      logger.info('Command /vote response sent', { roomId, responseCode: err instanceof DomainError ? err.code : 'UNKNOWN' });
    }
  });
}
