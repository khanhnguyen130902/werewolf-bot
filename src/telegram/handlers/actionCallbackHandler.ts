import { randomUUID } from 'crypto';
import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { GameFlowController } from '../GameFlowController';
import { parseActionCallbackData } from '../presenters/keyboards';
import { NightActionType } from '../../engine/domain/enums';
import { Messages } from '../presenters/messages';
import { translateError } from '../presenters/translateError';

const NIGHT_ACTION_TYPES: Set<string> = new Set([
  NightActionType.WEREWOLF_VOTE_KILL,
  NightActionType.SEER_INSPECT,
  NightActionType.BODYGUARD_PROTECT,
  NightActionType.WITCH_SAVE,
  NightActionType.WITCH_POISON,
]);

/**
 * Registers the single handler for all "action:<type>:<target>" callback
 * queries (night-action buttons and vote buttons share this one format).
 * Night-action submissions happen via DM (private chat), so the room they
 * belong to is looked up via StoragePort.getPlayerSession rather than from
 * ctx.chat.id (which would be the player's own private chat, not the room).
 *
 * After a successful night-action submission, this handler also checks
 * whether every player with a pending action has now submitted
 * (GameOrchestrator.allNightActionsSubmitted) and, if so, resolves the
 * night immediately instead of waiting for the full timer duration -- a
 * better experience than always waiting out the clock once everyone is
 * already done.
 *
 * Votes intentionally do NOT get the same early-resolve treatment: a vote
 * of `null` is a legitimate explicit abstain (confirmed business rule), so
 * "has this player voted yet" cannot be distinguished from "this player
 * abstained" using the voteTarget field alone -- doing so correctly would
 * require an additional "hasVoted" flag on PlayerState. Voting therefore
 * always runs the full configured duration, which is always correct (if
 * slightly less snappy) and avoids adding state purely for an optimization.
 */
export function registerActionCallbackHandler(
  services: BotServices,
  flowController: GameFlowController,
  bot: Telegraf<BotContext>,
): void {
  bot.on('callback_query', async (ctx, next) => {
    const cq = ctx.callbackQuery;
    if (!cq || !('data' in cq)) return next();

    const parsed = parseActionCallbackData(cq.data);
    if (!parsed) return next(); // not one of our "action:" buttons (e.g. hunter-shot:)

    const telegramId = String(ctx.from.id);
    const roomId = await services.storage.getPlayerSession(telegramId);
    if (!roomId) {
      await ctx.answerCbQuery('Không tìm thấy phòng chơi của bạn.');
      return;
    }

    try {
      if (parsed.actionType === 'VOTE') {
        await services.dayService.submitVote({
          roomId,
          actionId: randomUUID(),
          voterTelegramId: telegramId,
          targetTelegramId: parsed.targetTelegramId,
        });
        await ctx.answerCbQuery(Messages.voteRecorded());
        return;
      }

      if (NIGHT_ACTION_TYPES.has(parsed.actionType)) {
        await services.nightActionService.submitNightAction({
          roomId,
          actionId: randomUUID(),
          actorTelegramId: telegramId,
          actionType: parsed.actionType as NightActionType,
          targetTelegramId: parsed.targetTelegramId,
        });
        await ctx.answerCbQuery(Messages.actionRecorded());

        if (parsed.actionType === NightActionType.WEREWOLF_VOTE_KILL) {
          await flowController.promptWitchSaveForVictim(roomId, parsed.targetTelegramId);
        }

        const allSubmitted = await services.orchestrator.allNightActionsSubmitted(roomId);
        if (allSubmitted) {
          const {
            room: resolvedRoom,
            deaths,
            seerResults,
          } = await services.orchestrator.resolveNight({
            roomId,
            promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
          });
          await flowController.onNightResolved(resolvedRoom, deaths, seerResults);
        }
        return;
      }

      return next();
    } catch (err) {
      await ctx.answerCbQuery(translateError(err), { show_alert: true });
    }
  });
}
