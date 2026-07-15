import { randomUUID } from 'crypto';
import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { GameFlowController } from '../GameFlowController';
import { parseActionCallbackData } from '../presenters/keyboards';
import { NightActionType, RoleId } from '../../engine/domain/enums';
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
async function notifyWerewolfConsensusConflict(
  bot: Telegraf<BotContext>,
  room: Awaited<ReturnType<BotServices['nightActionService']['submitNightAction']>>,
): Promise<void> {
  const aliveWerewolves = Object.values(room.players).filter(
    (player) => player.alive && player.role === RoleId.WEREWOLF,
  );

  if (aliveWerewolves.length < 2) return;

  const latestSelections = new Map<string, string | null>();
  for (const action of room.pendingNightActions) {
    if (action.actionType !== NightActionType.WEREWOLF_VOTE_KILL) continue;
    if (action.round !== room.currentRound) continue;
    latestSelections.set(action.actorTelegramId, action.targetTelegramId);
  }

  const targets = Array.from(latestSelections.values()).filter(
    (target): target is string => Boolean(target),
  );
  if (targets.length < 2) return;

  const uniqueTargets = new Set(targets);
  if (uniqueTargets.size < 2) return;

  const message = '⚠️ Hai Sói đang chọn mục tiêu khác nhau. Hãy thống nhất lại một mục tiêu để giết.';
  for (const werewolf of aliveWerewolves) {
    try {
      await bot.telegram.sendMessage(werewolf.telegramId, message);
    } catch {
      // Non-fatal; best-effort notification only.
    }
  }
}

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
    void ctx.answerCbQuery('Đang xử lý...');

    try {
      const roomId = await services.storage.getPlayerSession(telegramId);
      if (!roomId) {
        await ctx.answerCbQuery('Không tìm thấy phòng chơi của bạn.');
        return;
      }

      if (parsed.actionType === 'VOTE') {
        void services.dayService.submitVote({
          roomId,
          actionId: randomUUID(),
          voterTelegramId: telegramId,
          targetTelegramId: parsed.targetTelegramId,
        });
        return;
      }

      if (NIGHT_ACTION_TYPES.has(parsed.actionType)) {
        const updatedRoom = await services.nightActionService.submitNightAction({
          roomId,
          actionId: randomUUID(),
          actorTelegramId: telegramId,
          actionType: parsed.actionType as NightActionType,
          targetTelegramId: parsed.targetTelegramId,
        });

        if (parsed.actionType === NightActionType.WEREWOLF_VOTE_KILL) {
          await notifyWerewolfConsensusConflict(bot, updatedRoom);
          void flowController.promptWitchSaveForVictim(roomId, parsed.targetTelegramId);
        }

        void services.orchestrator.allNightActionsSubmitted(roomId).then(async (allSubmitted) => {
          if (!allSubmitted) return;
          const {
            room: resolvedRoom,
            deaths,
            seerResults,
          } = await services.orchestrator.resolveNight({
            roomId,
            promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
          });
          await flowController.onNightResolved(resolvedRoom, deaths, seerResults);
        });
        return;
      }

      return next();
    } catch (err) {
      await ctx.answerCbQuery(translateError(err), { show_alert: true });
    }
  });
}
