import { randomUUID } from 'crypto';
import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { GameFlowController } from '../GameFlowController';
import { buildVoteKeyboard, parseActionCallbackData, TargetOption, buildTargetKeyboard } from '../presenters/keyboards';
import { Messages } from '../presenters/messages';
import { NightActionType, NightPhase, RoleId } from '../../engine/domain/enums';
import { RoomState } from '../../engine/domain/Room';
import { translateError } from '../presenters/translateError';
import { logger } from '../../infrastructure/logging/logger';

const resolvingExecutionRooms = new Set<string>();

const NIGHT_ACTION_TYPES: Set<string> = new Set([
  NightActionType.WEREWOLF_VOTE_KILL,
  NightActionType.SEER_INSPECT,
  NightActionType.BODYGUARD_PROTECT,
  NightActionType.HUNTER_SHOOT,
  NightActionType.WITCH_SAVE,
  NightActionType.WITCH_POISON,
]);

const ACTION_LABELS: Partial<Record<NightActionType, string>> = {
  [NightActionType.WEREWOLF_VOTE_KILL]: 'Bạn chọn cắn',
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

/**
 * Notifies all alive werewolves of the current vote status.
 * Returns true if there is a disagreement that requires further votes.
 */
async function notifyWerewolfVoteStatus(
  bot: Telegraf<BotContext>,
  room: RoomState,
): Promise<boolean> {
  const aliveWerewolves = Object.values(room.players).filter(
    (player) => player.alive && player.role === RoleId.WEREWOLF,
  );
  if (aliveWerewolves.length < 2) return false;

  const message = buildWerewolfVoteStatusMessage(room);
  if (!message) return false;

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
  const allChosen = chosenTargets.length === aliveWerewolves.length;
  const isDisagreement = allChosen && uniqueTargets.size !== 1;

  // Only send the re-vote keyboard to HUMAN (non-bot) werewolves.
  // Bot werewolves will be realigned on the NEXT human vote to avoid
  // immediately creating consensus and advancing the game prematurely.
  const aliveTargets: TargetOption[] = isDisagreement
    ? Object.values(room.players)
        .filter((p) => p.alive && p.role !== RoleId.WEREWOLF)
        .map((p) => ({ telegramId: p.telegramId, nickname: p.nickname }))
    : [];
  const keyboard = isDisagreement
    ? buildTargetKeyboard({ actionType: NightActionType.WEREWOLF_VOTE_KILL, targets: aliveTargets, includeSkip: false })
    : undefined;

  await Promise.all(
    aliveWerewolves.map(async (werewolf) => {
      try {
        // Skip sending keyboard to bots — they don't interact via Telegram
        if (isDisagreement && isWerewolfBot(werewolf.telegramId)) return;
        if (keyboard) {
          await bot.telegram.sendMessage(werewolf.telegramId, message, keyboard);
        } else {
          await bot.telegram.sendMessage(werewolf.telegramId, message);
        }
      } catch {
        // Non-fatal; best-effort notification only.
      }
    }),
  );

  return isDisagreement;
}

/** Matches bot player IDs injected by /bottest (prefix 999999900). */
function isWerewolfBot(telegramId: string): boolean {
  return telegramId.startsWith('999999900');
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

    try {
      const roomId = await services.storage.getPlayerSession(telegramId);
      if (!roomId) {
        await ctx.answerCbQuery('Không tìm thấy phòng chơi của bạn.').catch(() => undefined);
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
          await ctx.answerCbQuery(Messages.voteRecorded()).catch(() => undefined);
          await ctx.editMessageReplyMarkup(buildCurrentVoteKeyboard(updatedRoom).reply_markup).catch(() => undefined);
          await ctx.reply(
            Messages.targetSelected('Bạn đã bỏ phiếu cho', targetNickname(updatedRoom, parsed.targetTelegramId)),
          );

          // Check if all alive players have voted to resolve early
          const alivePlayers = Object.values(updatedRoom.players).filter((p) => p.alive);
          const allVoted = alivePlayers.every((p) => p.hasVotedThisRound);
          if (allVoted) {
            if (resolvingExecutionRooms.has(roomId)) {
              logger.debug('Execution resolution already in progress for room, skipping duplicate follow-up', { roomId });
              return;
            }

            resolvingExecutionRooms.add(roomId);
            void (async () => {
              try {
                logger.debug('Resolving execution early because all alive players have voted', { roomId });
                const {
                  room: resolvedRoom,
                  executedTelegramId,
                  deaths,
                } = await services.orchestrator.resolveExecution({
                  roomId,
                  promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
                });
                await flowController.onExecutionResolved(resolvedRoom, executedTelegramId, deaths);
              } catch (err) {
                logger.error('Error during early execution-resolution follow-up', { roomId, err });
              } finally {
                resolvingExecutionRooms.delete(roomId);
              }
            })();
          }
          return;
        } catch (err) {
          if ((err as any)?.code === 'DUPLICATE_ACTION') {
            await ctx.answerCbQuery(Messages.voteAlreadyCast(), { show_alert: true }).catch(() => undefined);
            return;
          }
          throw err;
        }
      }

      if (NIGHT_ACTION_TYPES.has(parsed.actionType)) {
        let updatedRoom: RoomState | undefined;
        try {
          updatedRoom = await services.nightActionService.submitNightAction({
            roomId,
            actionId: randomUUID(),
            actorTelegramId: telegramId,
            actionType: parsed.actionType as NightActionType,
            targetTelegramId: parsed.targetTelegramId,
          });
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
        } catch (err) {
          const message = translateError(err);
          const isInvalidTarget = err instanceof Error && err.message.includes('consecutively');
          const userMessage = isInvalidTarget
            ? 'Mục tiêu không hợp lệ: không thể chọn cùng một mục tiêu trên 2 đêm liên tiếp.'
            : message;
          await ctx.answerCbQuery(userMessage, { show_alert: true }).catch(() => undefined);
          return;
        }

        let werewolfDisagreement = false;
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

          werewolfDisagreement = await notifyWerewolfVoteStatus(bot, updatedRoom);

          // If human wolves have reached consensus (no disagreement),
          // realign any bot wolves that may still differ.
          if (!werewolfDisagreement && flowController.reAlignBotWerewolfVote) {
            await flowController.reAlignBotWerewolfVote(roomId).catch(() => undefined);
          }
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

        await ctx.answerCbQuery('Đã ghi nhận hành động.').catch(() => undefined);
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

        // If werewolves are still disagreeing, do NOT advance the game.
        // The keyboard has already been re-sent to human wolves above.
        // They will continue voting until consensus or timeout.
        if (werewolfDisagreement) {
          logger.debug('Werewolf disagreement detected — skipping early advance, awaiting re-vote', { roomId });
          return;
        }

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
      await ctx.answerCbQuery(translateError(err), { show_alert: true }).catch(() => undefined);
    }
  });
}
