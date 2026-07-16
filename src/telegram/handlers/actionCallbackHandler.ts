import { randomUUID } from 'crypto';
import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { GameFlowController } from '../GameFlowController';
import { buildVoteKeyboard, parseActionCallbackData, TargetOption } from '../presenters/keyboards';
import { Messages } from '../presenters/messages';
import { NightActionType, NightPhase, RoleId } from '../../engine/domain/enums';
import { RoomState } from '../../engine/domain/Room';
import { translateError } from '../presenters/translateError';
import { logger } from '../../infrastructure/logging/logger';

const NIGHT_ACTION_TYPES: Set<string> = new Set([
  NightActionType.WEREWOLF_VOTE_KILL,
  NightActionType.SEER_INSPECT,
  NightActionType.BODYGUARD_PROTECT,
  NightActionType.WITCH_SAVE,
  NightActionType.WITCH_POISON,
]);

const ACTION_LABELS: Partial<Record<NightActionType, string>> = {
  [NightActionType.WEREWOLF_VOTE_KILL]: 'Sói chọn cắn',
  [NightActionType.SEER_INSPECT]: 'Tiên tri chọn soi',
  [NightActionType.BODYGUARD_PROTECT]: 'Bảo vệ chọn bảo vệ',
  [NightActionType.HUNTER_SHOOT]: 'Thợ săn chọn mục tiêu bắn trả',
  [NightActionType.WITCH_SAVE]: 'Phù thủy chọn cứu',
  [NightActionType.WITCH_POISON]: 'Phù thủy chọn đầu độc',
};

function targetNickname(room: RoomState, targetTelegramId: string | null): string | null {
  return targetTelegramId ? room.players[targetTelegramId]?.nickname ?? targetTelegramId : null;
}

function buildCurrentVoteKeyboard(room: RoomState) {
  const targets: TargetOption[] = Object.values(room.players)
    .filter((player) => player.alive)
    .map((player) => ({ telegramId: player.telegramId, nickname: player.nickname }));
  const voteCounts: Record<string, number> = {};
  let skipCount = 0;

  for (const player of Object.values(room.players)) {
    if (!player.hasVotedThisRound) continue;
    if (player.voteTarget === null) {
      skipCount += 1;
    } else {
      voteCounts[player.voteTarget] = (voteCounts[player.voteTarget] ?? 0) + 1;
    }
  }

  return buildVoteKeyboard({ targets, voteCounts, skipCount });
}

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
 * of `null` is a legitimate explicit abstain, so voting always runs for the
 * full configured duration.
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
    if (parsed.actionType !== 'VOTE') {
      await ctx.answerCbQuery('Đã ghi nhận ✅');
    }

    try {
      const roomId = await services.storage.getPlayerSession(telegramId);
      if (!roomId) {
        await ctx.answerCbQuery('Không tìm thấy phòng chơi của bạn.');
        return;
      }

      if (parsed.actionType === 'VOTE') {
        try {
          const updatedRoom = await services.dayService.submitVote({
            roomId,
            actionId: randomUUID(),
            voterTelegramId: telegramId,
            targetTelegramId: parsed.targetTelegramId,
          });
          await ctx.answerCbQuery(Messages.voteRecorded());
          await ctx.editMessageReplyMarkup(buildCurrentVoteKeyboard(updatedRoom).reply_markup).catch(() => undefined);
          await ctx.reply(
            Messages.targetSelected('Bạn đã bỏ phiếu cho', targetNickname(updatedRoom, parsed.targetTelegramId)),
          );
          return;
        } catch (err) {
          if ((err as any)?.code === 'DUPLICATE_ACTION') {
            await ctx.answerCbQuery(Messages.voteAlreadyCast(), { show_alert: true });
            return;
          }
          throw err;
        }
      }

      if (NIGHT_ACTION_TYPES.has(parsed.actionType)) {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);

        const updatedRoom = await services.nightActionService.submitNightAction({
          roomId,
          actionId: randomUUID(),
          actorTelegramId: telegramId,
          actionType: parsed.actionType as NightActionType,
          targetTelegramId: parsed.targetTelegramId,
        });

        if (parsed.actionType === NightActionType.WEREWOLF_VOTE_KILL) {
          const werewolfActions = updatedRoom.pendingNightActions.filter(
            (a) =>
              a.actionType === NightActionType.WEREWOLF_VOTE_KILL &&
              a.round === updatedRoom.currentRound,
          );
          logger.debug('Werewolf vote submitted', {
            roomId,
            actorTelegramId: telegramId,
            targetTelegramId: parsed.targetTelegramId,
            totalWerewolfActions: werewolfActions.length,
            werewolfActions: werewolfActions.map((a) => ({
              actorTelegramId: a.actorTelegramId,
              targetTelegramId: a.targetTelegramId,
              round: a.round,
            })),
          });

          await notifyWerewolfVoteStatus(bot, updatedRoom);
        }

        if (parsed.actionType === NightActionType.SEER_INSPECT && parsed.targetTelegramId) {
          const target = updatedRoom.players[parsed.targetTelegramId];
          if (target?.team) {
            await bot.telegram.sendMessage(
              telegramId,
              Messages.seerResult(target.nickname, target.role && updatedRoom.settings.seerRevealsExactRole ? target.role : target.team),
              { parse_mode: 'Markdown' },
            ).catch(() => undefined);
          }
        }

        await ctx.answerCbQuery('Đã ghi nhận hành động.');
        await bot.telegram
          .sendMessage(
            telegramId,
            parsed.targetTelegramId
              ? Messages.targetSelected(
                  ACTION_LABELS[parsed.actionType as NightActionType] ?? 'Bạn đã chọn mục tiêu',
                  targetNickname(updatedRoom, parsed.targetTelegramId),
                )
              : Messages.nightActionSkipped(ACTION_LABELS[parsed.actionType as NightActionType] ?? 'Hành động của bạn'),
          )
          .catch(() => undefined);

        void (async () => {
          try {
            const allSubmitted = await services.orchestrator.allNightActionsSubmitted(roomId);
            logger.debug('Checked all night actions submitted', {
              roomId,
              allSubmitted,
              nightPhase: updatedRoom.nightPhase,
              currentRound: updatedRoom.currentRound,
            });
            if (!allSubmitted) return;
            if (updatedRoom.nightPhase !== NightPhase.WITCH) {
              logger.debug('Advancing to witch phase early because all night actions submitted', {
                roomId,
                nightPhase: updatedRoom.nightPhase,
              });
              await flowController.beginWitchPhase(roomId);
              return;
            }
            logger.debug('Resolving night early because all night actions submitted during witch phase', {
              roomId,
            });
            const {
              room: resolvedRoom,
              deaths,
              seerResults,
            } = await services.orchestrator.resolveNight({
              roomId,
              promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
            });
            await flowController.onNightResolved(resolvedRoom, deaths, seerResults);
          } catch (err) {
            logger.error('Error during early night-resolution follow-up', { roomId, err });
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
