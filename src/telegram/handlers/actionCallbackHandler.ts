import { randomUUID } from 'crypto';
import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { GameFlowController } from '../GameFlowController';
import { parseActionCallbackData } from '../presenters/keyboards';
import { Messages } from '../presenters/messages';
import { NightActionType, RoleId } from '../../engine/domain/enums';
import { RoomState } from '../../engine/domain/Room';
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
function formatWerewolfTarget(room: RoomState, targetTelegramId: string | null): string {
  if (!targetTelegramId) return 'chưa chọn';
  return room.players[targetTelegramId]?.nickname ?? targetTelegramId;
}

function buildWerewolfVoteStatusMessage(room: RoomState): string | null {
  const aliveWerewolves = Object.values(room.players).filter(
    (player) => player.alive && player.role === RoleId.WEREWOLF,
  );
  if (aliveWerewolves.length < 2) return null;

  const statusLines = aliveWerewolves.map((wolf) => {
    const action = room.pendingNightActions.find(
      (a) =>
        a.actorTelegramId === wolf.telegramId &&
        a.actionType === NightActionType.WEREWOLF_VOTE_KILL &&
        a.round === room.currentRound,
    );
    const targetText = formatWerewolfTarget(room, action?.targetTelegramId ?? null);
    return `- ${wolf.nickname}: ${targetText}`;
  });

  const chosenTargets = aliveWerewolves
    .map((wolf) => {
      const action = room.pendingNightActions.find(
        (a) =>
          a.actorTelegramId === wolf.telegramId &&
          a.actionType === NightActionType.WEREWOLF_VOTE_KILL &&
          a.round === room.currentRound,
      );
      return action?.targetTelegramId;
    })
    .filter((target): target is string => Boolean(target));
  const uniqueTargets = new Set(chosenTargets);

  const header = `✅ Đã ghi nhận lựa chọn của bạn.`;
  if (chosenTargets.length === 0) {
    return `${header}\n\nHiện tại các Sói chưa chọn mục tiêu nào.`;
  }

  const allChosen = chosenTargets.length === aliveWerewolves.length;
  if (allChosen && uniqueTargets.size === 1) {
    const targetNickname = formatWerewolfTarget(room, chosenTargets[0]);
    return `${header}\n\nHiện tại phe Sói đã thống nhất mục tiêu: ${targetNickname}.\n\n${statusLines.join('\n')}`;
  }

  if (!allChosen) {
    return `${header}\n\nHiện tại các Sói đã chọn như sau:\n${statusLines.join(
      '\n',
    )}\n\nHãy chờ Sói còn lại chọn và thống nhất mục tiêu.`;
  }

  return `${header}\n\n⚠️ Các Sói đang chọn mục tiêu khác nhau. Hãy thống nhất lại một mục tiêu để giết.\n\n${statusLines.join(
    '\n',
  )}`;
}

async function notifyWerewolfVoteStatus(
  bot: Telegraf<BotContext>,
  room: RoomState,
): Promise<void> {
  const aliveWerewolves = Object.values(room.players).filter(
    (player) => player.alive && player.role === RoleId.WEREWOLF,
  );
  if (aliveWerewolves.length < 2) return;

  const message = buildWerewolfVoteStatusMessage(room);
  if (!message) return;

  await Promise.all(
    aliveWerewolves.map(async (werewolf) => {
      try {
        await bot.telegram.sendMessage(werewolf.telegramId, message);
      } catch {
        // Non-fatal; best-effort notification only.
      }
    }),
  );
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
    await ctx.answerCbQuery('Đang xử lý...');

    try {
      const roomId = await services.storage.getPlayerSession(telegramId);
      if (!roomId) {
        await ctx.answerCbQuery('Không tìm thấy phòng chơi của bạn.');
        return;
      }

      if (parsed.actionType === 'VOTE') {
        await services.dayService.submitVote({
          roomId,
          actionId: randomUUID(),
          voterTelegramId: telegramId,
          targetTelegramId: parsed.targetTelegramId,
        });
        await ctx.answerCbQuery(Messages.voteRecorded());
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
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
          await notifyWerewolfVoteStatus(bot, updatedRoom);
        }

        await ctx.answerCbQuery('Đã ghi nhận hành động.');
        if (parsed.actionType !== NightActionType.WEREWOLF_VOTE_KILL) {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
        }

        void (async () => {
          try {
            if (parsed.actionType === NightActionType.WEREWOLF_VOTE_KILL) {
              await flowController.promptWitchSaveForVictim(roomId, parsed.targetTelegramId);
            }

            const allSubmitted = await services.orchestrator.allNightActionsSubmitted(roomId);
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
          } catch {
            // Follow-up actions are best-effort and should not leave the user
            // stuck with a callback that never gets acknowledged.
          }
        })();
        return;
      }

      return next();
    } catch (err) {
      await ctx.answerCbQuery(translateError(err), { show_alert: true });
    }
  });
}
