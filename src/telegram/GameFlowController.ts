import { Telegraf } from 'telegraf';
import { BotContext } from './BotContext';
import { BotServices } from './BotServices';
import { RoomState } from '../engine/domain/Room';
import { PlayerState } from '../engine/domain/Player';
import { RoleId, Team, NightActionType, NightPhase, GameState } from '../engine/domain/enums';
import { createPhase1RoleRegistry } from '../engine/roles/RoleRegistry';
import { Messages, RoleNames, DeathCauseNames } from './presenters/messages';
import { buildTargetKeyboard, buildVoteKeyboard, TargetOption } from './presenters/keyboards';
import { TimerJobType } from '../engine/RoomTimerService';

const roleRegistry = createPhase1RoleRegistry();
const TEST_BOT_ID_PREFIX = '999999900';

function isTestBot(telegramId: string): boolean {
  return telegramId.startsWith(TEST_BOT_ID_PREFIX);
}

function pickRandomTarget(targets: TargetOption[]): TargetOption | null {
  if (targets.length === 0) return null;
  return targets[Math.floor(Math.random() * targets.length)];
}

function pickImmediateBotTarget(room: RoomState, actor: PlayerState, targets: TargetOption[]): TargetOption | null {
  if (targets.length === 0) return null;

  if (actor.team === Team.WEREWOLF) {
    const enemyTargets = targets.filter((t) => room.players[t.telegramId]?.team !== Team.WEREWOLF);
    if (enemyTargets.length > 0) {
      return enemyTargets[Math.floor(Math.random() * enemyTargets.length)];
    }
  }

  return pickRandomTarget(targets);
}

/** Maps a role that has a regular per-night prompt to its NightActionType.
 * Hunter's normal-night action records a preselected revenge target. */
const ROLE_NIGHT_ACTION: Partial<Record<RoleId, NightActionType>> = {
  [RoleId.WEREWOLF]: NightActionType.WEREWOLF_VOTE_KILL,
  [RoleId.SEER]: NightActionType.SEER_INSPECT,
  [RoleId.BODYGUARD]: NightActionType.BODYGUARD_PROTECT,
  [RoleId.HUNTER]: NightActionType.HUNTER_SHOOT,
};

/** In-memory tracking of the currently-scheduled timer jobId per room, so it
 * can be cancelled early if all actions come in before the deadline. This
 * is a best-effort optimization only -- if the process restarts, this map
 * is empty and the timer simply fires at its originally scheduled time
 * (which RoomTimerService's persisted deadline + BullMQ's own durability
 * already guarantee happens correctly; see RoomTimerService doc). */
const activeTimerJobIds = new Map<string, string>();

/** Pending Hunter-revenge prompts awaiting a button click, keyed by
 * `${roomId}:${hunterTelegramId}`. A single persistent callback_query
 * listener (registered once in registerTimeoutHandlers/constructor-time via
 * registerHunterCallbackHandler) looks up and resolves the matching entry
 * instead of attaching/detaching a listener per prompt -- Telegraf does not
 * support removing an individual listener once added, so a per-call
 * bot.on/off pattern would leak a listener on every single Hunter prompt. */
interface PendingHunterPrompt {
  resolve: (decision: { targetTelegramId: string | null }) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}
const pendingHunterPrompts = new Map<string, PendingHunterPrompt>();

export class GameFlowController {
  constructor(
    private readonly services: BotServices,
    private readonly bot: Telegraf<BotContext>,
  ) {
    this.registerHunterCallbackHandler();
  }

  /** Registered exactly once per bot instance (in the constructor). Handles
   * every "hunter-shot:<hunterTelegramId>:<target|SKIP>" callback query by
   * looking up the corresponding pending prompt (if any is currently
   * awaited) and resolving it -- this is what lets promptHunterAndAwait's
   * returned Promise settle when the real button click arrives. */
  private registerHunterCallbackHandler(): void {
    this.bot.on('callback_query', async (ctx, next) => {
      const cq = ctx.callbackQuery;
      if (!cq || !('data' in cq) || !cq.data.startsWith('hunter-shot:')) {
        return next();
      }
      const [, hunterTelegramId, targetPart] = cq.data.split(':');
      if (String(ctx.from?.id) !== hunterTelegramId) {
        await ctx.answerCbQuery('Đây không phải lượt của bạn.');
        return;
      }

      const pending = pendingHunterPrompts.get(hunterTelegramId);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
      if (!pending) {
        // No prompt currently awaited for this Hunter (already resolved, or
        // a stale/duplicate button press) -- acknowledge and ignore.
        await ctx.answerCbQuery();
        return;
      }

      clearTimeout(pending.timeoutHandle);
      pendingHunterPrompts.delete(hunterTelegramId);
      pending.resolve({ targetTelegramId: targetPart === 'SKIP' ? null : targetPart });
      await ctx.answerCbQuery('Đã ghi nhận hành động.');

      const roomId = await this.services.storage.getPlayerSession(hunterTelegramId);
      let targetNickname: string | null = null;
      if (targetPart !== 'SKIP') {
        if (roomId) {
          const room = await this.services.roomService.getRoom(roomId);
          targetNickname = room?.players[targetPart]?.nickname ?? targetPart;
        } else {
          targetNickname = targetPart;
        }
      }
      await ctx.reply(
        Messages.targetSelected('Thợ săn chọn mục tiêu bắn trả', targetNickname),
      ).catch(() => undefined);
    });
  }

  /** Called right after GameService.startGame succeeds: announces the game
   * in the group, DMs every player their role, then kicks off the first
   * night. */
  async onGameStarted(room: RoomState): Promise<void> {
    const chatId = room.chatId;
    await this.bot.telegram.sendMessage(
      chatId,
      Messages.gameStarting(Object.keys(room.players).length),
    );

    const roleCounts = Object.values(room.players).reduce<Record<RoleId, number>>((acc, player) => {
      if (player.role) {
        acc[player.role] = (acc[player.role] ?? 0) + 1;
      }
      return acc;
    }, {} as Record<RoleId, number>);

    await this.bot.telegram.sendMessage(
      chatId,
      Messages.roleDistributionSummary(
        Object.keys(room.players).length,
        Object.entries(roleCounts).map(([roleId, count]) => ({
          roleId: roleId as RoleId,
          count,
        })),
      ),
    );

    const werewolves = Object.values(room.players).filter((player) => player.role === RoleId.WEREWOLF);

    for (const player of Object.values(room.players)) {
      if (!player.role) continue;
      if (isTestBot(player.telegramId)) continue;
      try {
        const roleMessage = Messages.roleAssigned(player.role);
        const teammateMessage =
          player.role === RoleId.WEREWOLF && werewolves.length >= 2
            ? `\n\n${Messages.werewolfTeammates(
                werewolves
                  .filter((teammate) => teammate.telegramId !== player.telegramId)
                  .map((teammate) => teammate.nickname),
              )}`
            : '';

        await this.bot.telegram.sendMessage(
          player.telegramId,
          `${roleMessage}${teammateMessage}`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        // Player may have blocked the bot or an unexpected DM failure
        // occurred after the join-time DM-reachability check passed; do not
        // let one failed DM abort the entire game-start flow for everyone
        // else. The group announcement above already told everyone the
        // game has started.
      }
    }

    await this.startNightPrompts(room);
  }

  /** Sends each role's night-action prompt (inline keyboard) via DM, and
   * schedules the night's timeout. */
  private async startNightPrompts(room: RoomState): Promise<void> {
    await this.bot.telegram.sendMessage(room.chatId, Messages.nightBegins(room.currentRound));

    // Arm the deadline before any DM is sent. A player can tap a button as
    // soon as Telegram receives it; scheduling first prevents that callback
    // from advancing to Phase 2 while this method later re-arms a stale
    // Phase-1 timer.
    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
    if (jobId) activeTimerJobIds.set(room.id, jobId);

    const alivePlayers = Object.values(room.players).filter((p) => p.alive);
    const aliveTargets: TargetOption[] = alivePlayers.map((p) => ({
      telegramId: p.telegramId,
      nickname: p.nickname,
    }));

    for (const player of alivePlayers) {
      if (!player.role) continue;

      if (player.role === RoleId.WITCH) continue;

      const actionType = ROLE_NIGHT_ACTION[player.role];
      if (!actionType) continue; // Villager, Hunter: no regular night prompt

      const roleDef = roleRegistry.get(player.role).definition;
      if (!roleDef.hasNightAction) continue;

      // Werewolves should not be offered another werewolf as a target
      // (WerewolfRole.validateNightAction enforces this too; filtering here
      // keeps the keyboard from offering an invalid choice in the first
      // place). Seer should not be offered themselves as a target.
      const targets = aliveTargets.filter((t) => {
        if (player.role === RoleId.WEREWOLF) {
          return room.players[t.telegramId]?.role !== RoleId.WEREWOLF;
        }
        if (player.role === RoleId.SEER) {
          return t.telegramId !== player.telegramId;
        }
        if (player.role === RoleId.BODYGUARD && !room.settings.bodyguardAllowSelfProtect) {
          return t.telegramId !== player.telegramId;
        }
        return true;
      });

      if (isTestBot(player.telegramId)) {
        const selection = pickImmediateBotTarget(room, player, targets);
        if (selection) {
          await this.services.nightActionService.submitNightAction({
            roomId: room.id,
            actionId: `bot-${player.telegramId}-${room.currentRound}-${actionType}-${selection.telegramId}`,
            actorTelegramId: player.telegramId,
            actionType,
            targetTelegramId: selection.telegramId,
          });
        }
        continue;
      }

      try {
        const promptText =
          player.role === RoleId.WEREWOLF && room.players[player.telegramId]?.role === RoleId.WEREWOLF
            ? `🌙 Đêm ${room.currentRound}: Hãy chọn mục tiêu giết. Hai Sói cần thống nhất cùng một mục tiêu.`
            : `🌙 Đêm ${room.currentRound}: Hãy chọn hành động của bạn (${RoleNames[player.role]}):`;

        await this.bot.telegram.sendMessage(
          player.telegramId,
          promptText,
          buildTargetKeyboard({ actionType, targets }),
        );
      } catch {
        // See onGameStarted's catch above for rationale.
      }
    }

  }

  /** Starts the Witch-only phase. It is safe to call more than once: the
   * service's phase write is idempotent, while only the first caller sends
   * the prompt/timer. */
  async beginWitchPhase(roomId: string): Promise<void> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room || room.nightPhase === NightPhase.WITCH) return;
    await this.cancelTimerIfAny(roomId);
    const hasLivingWitch = Object.values(room.players).some(
      (player) => player.alive && player.role === RoleId.WITCH,
    );
    if (!hasLivingWitch) {
      const { room: resolvedRoom, deaths, seerResults } = await this.services.orchestrator.resolveNight({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onNightResolved(resolvedRoom, deaths, seerResults);
      return;
    }
    const witchRoom = await this.services.nightActionService.beginWitchPhase(roomId);
    await this.promptWitchPhase(witchRoom);
    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(witchRoom);
    if (jobId) activeTimerJobIds.set(roomId, jobId);
  }

  private async promptWitchPhase(room: RoomState): Promise<void> {
    const witch = Object.values(room.players).find((p) => p.alive && p.role === RoleId.WITCH);
    if (!witch) return;
    const wolfChoices = room.pendingNightActions
      .filter((a) => a.actionType === NightActionType.WEREWOLF_VOTE_KILL && a.round === room.currentRound)
      .map((a) => a.targetTelegramId)
      .filter((id): id is string => Boolean(id));
    const victimId = wolfChoices.length > 0 && new Set(wolfChoices).size === 1 ? wolfChoices[0] : null;
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    if (victimId && room.witchPotions && !room.witchPotions.saveUsed) {
      const victim = room.players[victimId];
      if (victim) rows.push([{ text: `🧪 Cứu ${victim.nickname}`, callback_data: `action:WITCH_SAVE:${victimId}` }]);
    }
    if (room.witchPotions && !room.witchPotions.poisonUsed) {
      for (const player of Object.values(room.players).filter((p) => p.alive && p.telegramId !== witch.telegramId)) {
        rows.push([{ text: `☠️ Độc ${player.nickname}`, callback_data: `action:WITCH_POISON:${player.telegramId}` }]);
      }
    }
    rows.push([{ text: '⏭ Bỏ qua', callback_data: 'action:WITCH_SAVE:SKIP' }]);
    if (isTestBot(witch.telegramId)) {
      const hasSave = victimId !== null && room.witchPotions && !room.witchPotions.saveUsed;
      const hasPoison = room.witchPotions && !room.witchPotions.poisonUsed;
      const shouldSave = hasSave && Math.random() < 0.7;
      if (shouldSave) {
        try {
          await this.services.nightActionService.submitNightAction({
            roomId: room.id,
            actionId: `bot-witch-save-${witch.telegramId}-${room.currentRound}-${victimId}`,
            actorTelegramId: witch.telegramId,
            actionType: NightActionType.WITCH_SAVE,
            targetTelegramId: victimId,
          });
        } catch {
          // Ignore invalid bot action.
        }
      }

      if (hasPoison) {
        const poisonTargets = Object.values(room.players).filter(
          (player) => player.alive && player.telegramId !== witch.telegramId,
        );
        const poisonTarget = pickRandomTarget(poisonTargets.map((player) => ({
          telegramId: player.telegramId,
          nickname: player.nickname,
        })));
        if (poisonTarget && Math.random() < 0.4) {
          try {
            await this.services.nightActionService.submitNightAction({
              roomId: room.id,
              actionId: `bot-witch-poison-${witch.telegramId}-${room.currentRound}-${poisonTarget.telegramId}`,
              actorTelegramId: witch.telegramId,
              actionType: NightActionType.WITCH_POISON,
              targetTelegramId: poisonTarget.telegramId,
            });
          } catch {
            // Ignore invalid bot action.
          }
        }
      }
      return;
    }

    try {
      await this.bot.telegram.sendMessage(
        witch.telegramId,
        victimId
          ? `🌙 Đêm ${room.currentRound}: Sói đang chọn ${room.players[victimId]?.nickname ?? victimId}. Hãy chọn một hành động.`
          : `🌙 Đêm ${room.currentRound}: Sói chưa thống nhất mục tiêu. Hãy chọn một hành động.`,
        { reply_markup: { inline_keyboard: rows } },
      );
    } catch {
      // A failed DM must not prevent the Phase 2 timer from resolving.
    }
  }

  async promptWitchSaveForVictim(roomId: string, victimTelegramId: string | null): Promise<void> {
    if (!victimTelegramId) return;

    const room = await this.services.roomService.getRoom(roomId);
    if (!room || !room.witchPotions || room.witchPotions.saveUsed) return;

    const witch = Object.values(room.players).find(
      (player) => player.alive && player.role === RoleId.WITCH,
    );
    if (!witch) return;

    const victim = room.players[victimTelegramId];
    if (!victim || !victim.alive) return;

    try {
      await this.bot.telegram.sendMessage(
        witch.telegramId,
        `🌙 Đêm ${room.currentRound}: ${victim.nickname} vừa bị Sói cắn. Bạn có muốn dùng thuốc CỨU không?`,
        buildTargetKeyboard({
          actionType: NightActionType.WITCH_SAVE,
          targets: [{ telegramId: victimTelegramId, nickname: victim.nickname }],
        }),
      );
    } catch {
      // See onGameStarted's catch above for rationale.
    }
  }

  /** Prompts a Hunter who just died to choose a revenge-shot target, and
   * awaits their response (button click) or a timeout. This is the
   * HunterPromptFn implementation the GameOrchestrator calls into. */
  async promptHunterAndAwait(
    roomId: string,
    hunterTelegramId: string,
  ): Promise<{ targetTelegramId: string | null }> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room) return { targetTelegramId: null };

    const aliveTargets: TargetOption[] = Object.values(room.players)
      .filter((p) => p.alive && p.telegramId !== hunterTelegramId)
      .map((p) => ({ telegramId: p.telegramId, nickname: p.nickname }));

    if (isTestBot(hunterTelegramId)) {
      const pick = pickRandomTarget(aliveTargets);
      return { targetTelegramId: pick?.telegramId ?? null };
    }

    const seconds = room.settings.timers.nightActionSeconds;

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        pendingHunterPrompts.delete(hunterTelegramId);
        resolve({ targetTelegramId: null });
      }, seconds * 1000);

      pendingHunterPrompts.set(hunterTelegramId, { resolve, timeoutHandle });

      const rows = aliveTargets.map((t) => [
        { text: t.nickname, callback_data: `hunter-shot:${hunterTelegramId}:${t.telegramId}` },
      ]);
      rows.push([{ text: '⏭ Bỏ qua', callback_data: `hunter-shot:${hunterTelegramId}:SKIP` }]);

      this.bot.telegram
        .sendMessage(hunterTelegramId, Messages.hunterPrompt(seconds), {
          reply_markup: { inline_keyboard: rows },
        })
        .catch(() => {
          // Hunter can't be DMed at all -- resolve immediately as "declined"
          // rather than waiting the full timeout for a message that will
          // never be seen.
          const pending = pendingHunterPrompts.get(hunterTelegramId);
          if (pending) {
            clearTimeout(pending.timeoutHandle);
            pendingHunterPrompts.delete(hunterTelegramId);
            resolve({ targetTelegramId: null });
          }
        });
    });
  }

  /** Called after a night resolves: announces deaths in the group, delivers
   * each Seer's private inspection result, then advances to discussion (or
   * announces game over). */
  async onNightResolved(
    room: RoomState,
    deaths: Array<{ telegramId: string; cause: string }>,
    seerResults: Array<{
      seerTelegramId: string;
      targetTelegramId: string;
      revealedTeam: string;
      revealedRole: string | null;
    }>,
  ): Promise<void> {
    await this.cancelTimerIfAny(room.id);

    const deathsWithNicknames = deaths.map((d) => ({
      nickname: room.players[d.telegramId]?.nickname ?? d.telegramId,
      cause: d.cause,
    }));
    await this.bot.telegram.sendMessage(
      room.chatId,
      Messages.dayBegins(room.currentRound, deathsWithNicknames),
    );

    // Seer results are delivered immediately when the inspection is submitted;
    // they are still returned by the engine for auditability and tests.
    void seerResults;

    if (room.gameState === GameState.GAME_OVER) {
      await this.announceGameOver(room);
      return;
    }

    await this.startDiscussion(room.id);
  }

  async startDiscussion(roomId: string): Promise<void> {
    const room = await this.services.dayService.startDiscussion(roomId);
    const seconds = room.settings.timers.discussionSeconds;
    await this.bot.telegram.sendMessage(room.chatId, Messages.discussionStarted(seconds));

    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
    if (jobId) activeTimerJobIds.set(room.id, jobId);
  }

  async startVoting(roomId: string): Promise<void> {
    await this.cancelTimerIfAny(roomId);
    const room = await this.services.dayService.startVoting(roomId);
    const seconds = room.settings.timers.votingSeconds;

    const aliveTargets: TargetOption[] = Object.values(room.players)
      .filter((p) => p.alive)
      .map((p) => ({ telegramId: p.telegramId, nickname: p.nickname }));

    await this.bot.telegram.sendMessage(
      room.chatId,
      Messages.votingStarted(seconds),
      buildVoteKeyboard({ targets: aliveTargets, voteCounts: {}, skipCount: 0 }),
    );

    for (const player of Object.values(room.players)) {
      if (!player.alive || !isTestBot(player.telegramId)) continue;
      const targetOption = pickRandomTarget(aliveTargets);
      if (!targetOption) continue;
      try {
        await this.services.dayService.submitVote({
          roomId: room.id,
          actionId: `bot-vote-${player.telegramId}-${room.currentRound}-${targetOption.telegramId}`,
          voterTelegramId: player.telegramId,
          targetTelegramId: targetOption.telegramId,
        });
      } catch {
        // Ignore duplicate or invalid bot votes.
      }
    }

    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
    if (jobId) activeTimerJobIds.set(room.id, jobId);
  }

  async onExecutionResolved(
    room: RoomState,
    executedTelegramId: string | null,
    deaths: Array<{ telegramId: string; cause: string }>,
  ): Promise<void> {
    await this.cancelTimerIfAny(room.id);

    const executedNickname = executedTelegramId
      ? (room.players[executedTelegramId]?.nickname ?? executedTelegramId)
      : null;
    await this.bot.telegram.sendMessage(room.chatId, Messages.executionResult(executedNickname));

    const extraDeaths = deaths.filter((d) => d.telegramId !== executedTelegramId);
    for (const death of extraDeaths) {
      const nickname = room.players[death.telegramId]?.nickname ?? death.telegramId;
      await this.bot.telegram.sendMessage(
        room.chatId,
        `💀 ${nickname} đã ${DeathCauseNames[death.cause] ?? death.cause}.`,
      );
    }

    if (room.gameState === GameState.GAME_OVER) {
      await this.announceGameOver(room);
      return;
    }

    await this.startNightPrompts(room);
  }

  private async announceGameOver(room: RoomState): Promise<void> {
    const aliveWerewolves = Object.values(room.players).filter(
      (p) => p.alive && p.role === RoleId.WEREWOLF,
    ).length;
    const winner = aliveWerewolves === 0 ? 'VILLAGE' : 'WEREWOLF';
    await this.bot.telegram.sendMessage(room.chatId, Messages.gameOver(winner));

    const finalRoles = Object.values(room.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        nickname: player.nickname,
        roleId: player.role ?? RoleId.VILLAGER,
      }));
    await this.bot.telegram.sendMessage(room.chatId, Messages.finalRoleSummary(finalRoles));
  }

  private async cancelTimerIfAny(roomId: string): Promise<void> {
    const jobId = activeTimerJobIds.get(roomId);
    if (jobId) {
      await this.services.orchestrator.cancelCurrentPhaseTimer(roomId, jobId);
      activeTimerJobIds.delete(roomId);
    }
  }

  /** Registers the BullMQ timeout handlers for all three timed phases. Each
   * handler is defensive: it re-checks the room's current state before
   * acting, since a timer could theoretically fire after the phase already
   * advanced via early resolution (all players acted before the deadline). */
  registerTimeoutHandlers(): void {
    this.services.timerService.onTimeout(TimerJobType.NIGHT_ACTION_TIMEOUT, async (roomId) => {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room) return;
      if (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT) return;

      if (room.nightPhase !== NightPhase.WITCH) {
        await this.beginWitchPhase(roomId);
        return;
      }

      const {
        room: resolvedRoom,
        deaths,
        seerResults,
      } = await this.services.orchestrator.resolveNight({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onNightResolved(resolvedRoom, deaths, seerResults);
    });

    this.services.timerService.onTimeout(TimerJobType.WITCH_ACTION_TIMEOUT, async (roomId) => {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room || room.nightPhase !== NightPhase.WITCH) return;
      const { room: resolvedRoom, deaths, seerResults } = await this.services.orchestrator.resolveNight({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onNightResolved(resolvedRoom, deaths, seerResults);
    });

    this.services.timerService.onTimeout(TimerJobType.DISCUSSION_TIMEOUT, async (roomId) => {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room || room.gameState !== GameState.DISCUSSION) return;
      await this.startVoting(roomId);
    });

    this.services.timerService.onTimeout(TimerJobType.VOTING_TIMEOUT, async (roomId) => {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room || room.gameState !== GameState.VOTING) return;

      const {
        room: resolvedRoom,
        executedTelegramId,
        deaths,
      } = await this.services.orchestrator.resolveExecution({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onExecutionResolved(resolvedRoom, executedTelegramId, deaths);
    });
  }
}
