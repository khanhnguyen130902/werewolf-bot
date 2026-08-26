import { Telegraf } from 'telegraf';

type SendMessageExtra = Parameters<Telegraf<BotContext>['telegram']['sendMessage']>[2];
import { BotContext } from './BotContext';
import { BotServices } from './BotServices';
import { RoomState } from '../engine/domain/Room';
import { PlayerState } from '../engine/domain/Player';
import { RoleId, Team, NightActionType, NightPhase, GameState } from '../engine/domain/enums';
import { createPhase1RoleRegistry } from '../engine/roles/RoleRegistry';
import { Messages, DeathCauseNames } from './presenters/messages';
import { ACTION_DISPLAY_NAMES } from './presenters/canonicalContent';
import { buildTargetKeyboard, buildVoteKeyboard, TargetOption } from './presenters/keyboards';
import { TimerJobType } from '../engine/RoomTimerService';
import { logger } from '../infrastructure/logging/logger';
import { MuteService } from './MuteService';
import { DuplicateActionError } from '../engine/errors/DomainError';
import { resolvingExecutionRooms } from './resolvingExecutionRooms';
import { resolvingNightRooms } from './resolvingNightRooms';
import { BotPolicy } from './BotPolicy';
import { BotDialogue } from './BotDialogue';

const roleRegistry = createPhase1RoleRegistry();
const TEST_BOT_ID_PREFIX = '999999900';

function isTestBot(telegramId: string): boolean {
  return telegramId.startsWith(TEST_BOT_ID_PREFIX);
}

const DEFAULT_BOT_TURN_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 350;

function getBotTurnDelayMs(): number {
  const configured = Number(process.env.BOT_TURN_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_BOT_TURN_DELAY_MS;
}

async function waitForBotTurn(): Promise<void> {
  const delayMs = getBotTurnDelayMs();
  if (delayMs === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function pickRandomTarget(targets: TargetOption[]): TargetOption | null {
  if (targets.length === 0) return null;
  return targets[Math.floor(Math.random() * targets.length)];
}

function serializeError(err: unknown): { name: string; message: string; stack?: string } | { value: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/** Maps a role that has a regular per-night prompt to its NightActionType.
 * Hunter's normal-night action records a preselected revenge target. */
const ROLE_NIGHT_ACTION: Partial<Record<RoleId, NightActionType>> = {
  [RoleId.WEREWOLF]: NightActionType.WEREWOLF_VOTE_KILL,
  [RoleId.SEER]: NightActionType.SEER_INSPECT,
  [RoleId.BODYGUARD]: NightActionType.BODYGUARD_PROTECT,
  [RoleId.HUNTER]: NightActionType.HUNTER_SHOOT,
  [RoleId.SILENT_MAGE]: NightActionType.SILENT_MAGE_SILENCE,
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
  public readonly botPolicy: BotPolicy;
  public readonly muteService: MuteService;
  private readonly presentedBallotIds = new Set<string>();

  constructor(
    private readonly services: BotServices,
    private readonly bot: Telegraf<BotContext>,
  ) {
    this.botPolicy = new BotPolicy();
    this.muteService = new MuteService(this.bot, this.services.redis);
    this.registerHunterCallbackHandler();
  }

  async unmuteAllPlayers(
    chatId: string | number,
    options: { clearFallbackOnFailure?: boolean } = {},
  ): Promise<void> {
    await this.muteService.unmuteAllPlayers(chatId, options);
  }

  /** Telegram delivery is a presentation side effect. A transient API failure
   * must be logged and isolated so an already-committed engine transition can
   * still schedule the next phase or reach GAME_OVER. */
  private async safeSendMessage(
    chatId: string | number,
    text: string,
    extra?: SendMessageExtra,
    operation = 'sendMessage',
  ): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, text, extra);
    } catch (err) {
      logger.error('Telegram delivery failed; continuing game flow', {
        operation,
        chatId: String(chatId),
        error: serializeError(err),
      });
    }
  }

  /** Sends a private, non-sensitive death notice after the engine commits deaths.
   * Delivery is best-effort: a DM failure must never block public announcements
   * or the next phase transition. */
  private async notifyDeadPlayersByDm(
    deaths: Array<{ telegramId: string; cause: string }>,
    operation: string,
  ): Promise<void> {
    const uniqueDeadPlayerIds = [...new Set(deaths.map((death) => death.telegramId))];
    for (const telegramId of uniqueDeadPlayerIds) {
      await this.safeSendMessage(
        telegramId,
        Messages.deathPrivateNotice(),
        undefined,
        operation,
      );
    }
  }

  /** Records a bot's action, falling back to an explicit Skip if its chosen
   * target became invalid between prompt construction and submission. Bot
   * actions must never abort the prompt loop for the remaining roles. */
  private async submitBotNightAction(params: {
    room: RoomState;
    player: PlayerState;
    actionType: NightActionType;
    targetTelegramId: string | null;
  }): Promise<void> {
    const submit = async (targetTelegramId: string | null) => {
      await this.services.nightActionService.submitNightAction({
        roomId: params.room.id,
        actionId: `bot-${params.player.telegramId}-${params.room.currentRound}-${params.actionType}-${targetTelegramId ?? 'SKIP'}`,
        actorTelegramId: params.player.telegramId,
        actionType: params.actionType,
        targetTelegramId,
      });
    };

    try {
      await submit(params.targetTelegramId);
    } catch (err) {
      if (err instanceof DuplicateActionError) {
        logger.debug('Bot night action was already submitted; ignoring duplicate', { roomId: params.room.id, actorTelegramId: params.player.telegramId, actionType: params.actionType });
        return;
      }
      if (params.targetTelegramId === null) {
        logger.error('Bot failed to submit an explicit night skip', {
          roomId: params.room.id,
          actorTelegramId: params.player.telegramId,
          actionType: params.actionType,
          err,
        });
        return;
      }

      try {
        await submit(null);
      } catch (skipErr) {
        logger.error('Bot failed to submit a night action and its fallback skip', {
          roomId: params.room.id,
          actorTelegramId: params.player.telegramId,
          actionType: params.actionType,
          err: skipErr,
        });
      }
    }
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
    this.botPolicy.startRoom(room.id);
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

    const DmPromises = Object.values(room.players).map(async (player) => {
      if (!player.role) return;
      if (isTestBot(player.telegramId)) return;
      try {
        const teammateNames =
          player.role === RoleId.WEREWOLF && werewolves.length >= 2
            ? werewolves
                .filter((teammate) => teammate.telegramId !== player.telegramId)
                .map((teammate) => teammate.nickname)
            : [];
        const roleMessage = Messages.roleAssigned(player.role, teammateNames);

        await this.bot.telegram.sendMessage(
          player.telegramId,
          roleMessage,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        logger.error('Failed to deliver role DM; continuing game start', {
          roomId: room.id,
          playerTelegramId: player.telegramId,
          err,
        });
      }
    });

    await Promise.all(DmPromises);

    await this.startNightPrompts(room);
  }

  async notifyWerewolfNoConsensus(room: RoomState): Promise<void> {
    const aliveWerewolves = Object.values(room.players).filter(
      (player) => player.alive && player.role === RoleId.WEREWOLF,
    );

    if (aliveWerewolves.length === 0) return;

    const latestChoices = new Map<string, string | null>();
    for (const action of room.pendingNightActions) {
      if (action.actionType === NightActionType.WEREWOLF_VOTE_KILL && action.round === room.currentRound) {
        latestChoices.set(action.actorTelegramId, action.targetTelegramId);
      }
    }
    const hasConsensus =
      aliveWerewolves.every((werewolf) => latestChoices.has(werewolf.telegramId)) &&
      new Set(latestChoices.values()).size === 1;

    if (hasConsensus) return;

    await Promise.all(
      aliveWerewolves.map(async (werewolf) => {
        // Synthetic bottest players do not have real Telegram private chats;
        // they are simulated in-process and must not produce expected
        // `chat not found` API errors during a no-consensus notification.
        if (isTestBot(werewolf.telegramId)) return;
        try {
          await this.bot.telegram.sendMessage(werewolf.telegramId, Messages.werewolfNoConsensusNotice(), { parse_mode: 'Markdown' });
        } catch (err) {
          logger.error('Failed to deliver werewolf no-consensus DM', {
            roomId: room.id,
            playerTelegramId: werewolf.telegramId,
            err,
          });
        }
      }),
    );
  }

  /** Sends each role's night-action prompt (inline keyboard) via DM, and
   * schedules the night's timeout. */
  private async startNightPrompts(room: RoomState): Promise<void> {
    // Lock the group before announcing the night. Night actions use private
    // callback queries, so this does not prevent players from submitting their
    // role actions while it blocks group chat messages.
    await this.muteService.mutePlayers(
      room.chatId,
      Object.values(room.players).map((player) => player.telegramId),
    );

    await this.safeSendMessage(
      room.chatId,
      Messages.nightBegins(room.currentRound),
      undefined,
      'night-begins',
    );

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

    const promptPromises = alivePlayers.map(async (player) => {
      if (!player.role) return;

      if (player.role === RoleId.WITCH) return;

      const actionType = ROLE_NIGHT_ACTION[player.role];
      if (!actionType) return; // Villager, Hunter: no regular night prompt

      const roleDef = roleRegistry.get(player.role).definition;
      if (!roleDef.hasNightAction) return;

      // Werewolf faction voting deliberately includes every living player:
      // Skip, self, fellow wolves, and other living players. Seer should not
      // be offered themselves as a target.
      const targets = aliveTargets.filter((t) => {
        if (player.role === RoleId.SEER) {
          return t.telegramId !== player.telegramId;
        }
        if (player.role === RoleId.BODYGUARD && !room.settings.bodyguardAllowSelfProtect) {
          return t.telegramId !== player.telegramId;
        }
        return true;
      });

      if (isTestBot(player.telegramId)) {
        await waitForBotTurn();
        const selection = this.botPolicy.chooseNightTarget(room, player, targets, room.id);
        await this.submitBotNightAction({
          room,
          player,
          actionType,
          targetTelegramId: selection?.telegramId ?? null,
        });
        return;
      }

      try {
        const promptText = Messages.nightActionPrompt(
          room.currentRound,
          player.role,
          ACTION_DISPLAY_NAMES[actionType] ?? 'hành động',
        );

        const sentMsg = await this.bot.telegram.sendMessage(
          player.telegramId,
          promptText,
          buildTargetKeyboard({ actionType, targets }),
        );
        // Save the sent message ID to Redis to clear it later on timeout
        await this.services.redis.set(
          `prompt-message:${room.id}:${player.telegramId}`,
          String(sentMsg.message_id),
          'EX',
          86400 // 1 day
        );
      } catch (err) {
        logger.error('Failed to deliver night-action prompt; continuing prompt fan-out', {
          roomId: room.id,
          playerTelegramId: player.telegramId,
          actionType,
          err,
        });
      }
    });

    await Promise.all(promptPromises);

    await this.advanceNightIfReady(room.id);
  }

  private async advanceNightIfReady(roomId: string): Promise<void> {
    if (!(await this.services.orchestrator.allNightActionsSubmitted(roomId))) return;
    const room = await this.services.roomService.getRoom(roomId);
    if (!room) return;
    if (room.nightPhase !== NightPhase.WITCH) {
      await this.beginWitchPhase(roomId);
      return;
    }
    await this.resolveNight(roomId);
  }

  /** If bot werewolves disagree with a human werewolf, re-align them to the human's target. */
  async reAlignBotWerewolfVote(roomId: string): Promise<void> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room) return;

    const wolfActions = room.pendingNightActions.filter(
      (a) => a.actionType === NightActionType.WEREWOLF_VOTE_KILL && a.round === room.currentRound,
    );

    const humanWolfAction = wolfActions.find((a) => !isTestBot(a.actorTelegramId));
    if (!humanWolfAction || !humanWolfAction.targetTelegramId) return;

    const botWolves = Object.values(room.players).filter(
      (p) => p.alive && p.role === RoleId.WEREWOLF && isTestBot(p.telegramId)
    );

    for (const botWolf of botWolves) {
      const botAction = wolfActions.find((a) => a.actorTelegramId === botWolf.telegramId);
      if (botAction && botAction.targetTelegramId !== humanWolfAction.targetTelegramId) {
        await this.services.nightActionService.submitNightAction({
          roomId,
          actionId: `bot-realign-${botWolf.telegramId}-${room.currentRound}-${Date.now()}`,
          actorTelegramId: botWolf.telegramId,
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: humanWolfAction.targetTelegramId,
        });
      }
    }
  }

  /** Starts the Witch-only phase. It is safe to call more than once: the
   * service's phase write is idempotent, while only the first caller sends
   * the prompt/timer. */
  async beginWitchPhase(roomId: string): Promise<void> {
    if (resolvingNightRooms.has(roomId)) {
      logger.debug('beginWitchPhase: night resolution/transition already in progress, skipping', { roomId });
      return;
    }
    resolvingNightRooms.add(roomId);
    try {
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

      // If Witch is a bot, it will have submitted its action during promptWitchPhase.
      // Check if we can resolve the night early.
      const allSubmitted = await this.services.orchestrator.allNightActionsSubmitted(roomId);
      if (allSubmitted) {
        const { room: resolvedRoom, deaths, seerResults } = await this.services.orchestrator.resolveNight({
          roomId,
          promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
        });
        await this.onNightResolved(resolvedRoom, deaths, seerResults);
        return;
      }

      const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(witchRoom);
      if (jobId) activeTimerJobIds.set(roomId, jobId);
    } finally {
      resolvingNightRooms.delete(roomId);
    }
  }

  /**
   * Resolves the current night with concurrency guard resolvingNightRooms.
   * If a resolution is already running for the room, does nothing.
   */
  async resolveNight(roomId: string): Promise<void> {
    if (resolvingNightRooms.has(roomId)) {
      logger.debug('resolveNight: night resolution already in progress, skipping', { roomId });
      return;
    }
    resolvingNightRooms.add(roomId);
    try {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room) return;
      if (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT) return;

      const { room: resolvedRoom, deaths, seerResults } = await this.services.orchestrator.resolveNight({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onNightResolved(resolvedRoom, deaths, seerResults);
    } catch (err) {
      logger.error('resolveNight: night resolution failed', { roomId, err });
    } finally {
      resolvingNightRooms.delete(roomId);
    }
  }

  /**
   * Resolves the execution phase with concurrency guard resolvingExecutionRooms.
   * If an execution resolution is already running for the room, does nothing.
   */
  async resolveExecution(roomId: string): Promise<void> {
    if (resolvingExecutionRooms.has(roomId)) {
      logger.debug('resolveExecution: execution already in progress, skipping', { roomId });
      return;
    }
    resolvingExecutionRooms.add(roomId);
    try {
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
    } catch (err) {
      logger.error('resolveExecution: execution resolution failed', { roomId, err });
    } finally {
      resolvingExecutionRooms.delete(roomId);
    }
  }

  private async promptWitchPhase(room: RoomState): Promise<void> {
    const witch = Object.values(room.players).find((p) => p.alive && p.role === RoleId.WITCH);
    if (!witch) return;
    const aliveWerewolves = Object.values(room.players).filter(
      (player) => player.alive && player.role === RoleId.WEREWOLF,
    );
    const wolfChoices = new Map<string, string | null>();
    for (const action of room.pendingNightActions) {
      if (action.actionType === NightActionType.WEREWOLF_VOTE_KILL && action.round === room.currentRound) {
        wolfChoices.set(action.actorTelegramId, action.targetTelegramId);
      }
    }
    const victimId =
      aliveWerewolves.every((wolf) => wolfChoices.has(wolf.telegramId)) &&
      new Set(wolfChoices.values()).size === 1
        ? wolfChoices.values().next().value ?? null
        : null;
    const saveKeyboard = victimId && room.witchPotions && !room.witchPotions.saveUsed
      ? buildTargetKeyboard({
          actionType: NightActionType.WITCH_SAVE,
          targets: [{ telegramId: victimId, nickname: room.players[victimId]?.nickname ?? victimId }],
        })
      : null;
    const poisonKeyboard = room.witchPotions && !room.witchPotions.poisonUsed
      ? buildTargetKeyboard({
          actionType: NightActionType.WITCH_POISON,
          targets: Object.values(room.players)
            .filter((player) => player.alive && player.telegramId !== witch.telegramId)
            .map((player) => ({ telegramId: player.telegramId, nickname: player.nickname })),
        })
      : null;
    if (isTestBot(witch.telegramId)) {
      if (saveKeyboard) {
        const shouldSave = Math.random() < 0.7;
        await this.submitBotNightAction({
          room,
          player: witch,
          actionType: NightActionType.WITCH_SAVE,
          targetTelegramId: shouldSave ? victimId : null,
        });
      }
      if (poisonKeyboard) {
        const poisonTargets = Object.values(room.players)
          .filter((player) => player.alive && player.telegramId !== witch.telegramId)
          .map((player) => ({ telegramId: player.telegramId, nickname: player.nickname }));
        const poisonTarget = pickRandomTarget(poisonTargets);
        const shouldPoison = poisonTarget !== null && Math.random() < 0.4;
        await this.submitBotNightAction({
          room,
          player: witch,
          actionType: NightActionType.WITCH_POISON,
          targetTelegramId: shouldPoison ? poisonTarget.telegramId : null,
        });
      }
      return;
    }
    const prompts: Array<Promise<unknown>> = [];
    if (saveKeyboard) {
      prompts.push(
        (async () => {
          try {
            const sentMsg = await this.bot.telegram.sendMessage(
              witch.telegramId,
              Messages.witchSavePrompt(room.currentRound, room.players[victimId!]?.nickname ?? victimId),
              saveKeyboard,
            );
            await this.services.redis.set(
              `witch-save-message:${room.id}:${witch.telegramId}`,
              String(sentMsg.message_id),
              'EX',
              86400
            );
          } catch {}
        })()
      );
    }
    if (poisonKeyboard) {
      prompts.push(
        (async () => {
          try {
            const sentMsg = await this.bot.telegram.sendMessage(
              witch.telegramId,
              Messages.witchPoisonPrompt(room.currentRound),
              poisonKeyboard,
            );
            await this.services.redis.set(
              `witch-poison-message:${room.id}:${witch.telegramId}`,
              String(sentMsg.message_id),
              'EX',
              86400
            );
          } catch {}
        })()
      );
    }
    await Promise.all(prompts);
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
        Messages.witchSavePrompt(room.currentRound, victim.nickname),
        buildTargetKeyboard({
          actionType: NightActionType.WITCH_SAVE,
          targets: [{ telegramId: victimTelegramId, nickname: victim.nickname }],
        }),
      );
    } catch (err) {
      logger.error('Failed to deliver Witch save prompt', {
        roomId,
        witchTelegramId: witch.telegramId,
        victimTelegramId,
        err,
      });
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
        .sendMessage(
          hunterTelegramId,
          Messages.hunterPrompt(room.currentRound),
          {
            reply_markup: { inline_keyboard: rows },
          },
        )
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

    if (deaths.length > 0) {
      await this.muteService.mutePlayers(room.chatId, deaths.map((d) => d.telegramId));
      await this.notifyDeadPlayersByDm(deaths, 'death-dm-night');
    }

    // Night-wide mute ends for living players when the day begins. Dead
    // players are intentionally excluded so the existing dead-player mute
    // contract remains in force until game over or /end.
    if (room.gameState !== GameState.GAME_OVER) {
      await this.muteService.unmutePlayers(
        room.chatId,
        Object.values(room.players)
          .filter((player) => player.alive)
          .map((player) => player.telegramId),
      );
    }

    for (const res of seerResults) {
      if (!isTestBot(res.seerTelegramId)) continue;
      const targetPlayer = room.players[res.targetTelegramId];
      if (!targetPlayer) continue;
      this.botPolicy.recordInspection(room.id, {
        seerTelegramId: res.seerTelegramId,
        targetTelegramId: res.targetTelegramId,
        targetNickname: targetPlayer.nickname,
        revealedTeam: res.revealedTeam,
        revealedRole: res.revealedRole,
      });
    }

    const deathsWithNicknames = deaths.map((d) => ({
      nickname: room.players[d.telegramId]?.nickname ?? d.telegramId,
    }));
    const silencedPlayer = room.silencedPlayerId ? room.players[room.silencedPlayerId] : undefined;
    await this.safeSendMessage(
      room.chatId,
      Messages.dayBegins(room.currentRound, deathsWithNicknames, silencedPlayer?.alive ? silencedPlayer.nickname : null),
      undefined,
      'day-begins',
    );

    // Seer results are delivered immediately when the inspection is submitted;
    // they are still returned by the engine for auditability and tests.

    if (room.gameState === GameState.GAME_OVER) {
      await this.announceGameOver(room);
      return;
    }

    await this.startDiscussion(room.id);
  }

  async startDiscussion(roomId: string): Promise<void> {
    const openingRoom = await this.services.dayService.startDiscussion(roomId);
    await this.activateDiscussionOpening(openingRoom);
  }

  async resumeDiscussionOpening(roomId: string): Promise<void> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room || room.gameState !== GameState.DISCUSSION) return;
    if (room.discussionLifecycle === 'ACTIVE' && room.discussionEnforcementReady === true) return;
    await this.activateDiscussionOpening(room);
  }

  private async activateDiscussionOpening(openingRoom: RoomState): Promise<void> {
    const seconds = openingRoom.settings.timers.discussionSeconds;
    await this.safeSendMessage(
      openingRoom.chatId,
      Messages.discussionStarted(seconds),
      undefined,
      'discussion-started',
    );
    const cycleId = openingRoom.discussionCycleId;
    if (!cycleId) return;
    const room = await this.services.dayService.activateDiscussion(openingRoom.id, cycleId);

    // Simulate bot chat only after the persisted enforcement gate is ACTIVE.
    this.scheduleBotDiscussion(room.id);

    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
    if (jobId) activeTimerJobIds.set(room.id, jobId);
  }

  private scheduleBotDiscussion(roomId: string): void {
    setTimeout(async () => {
      const room = await this.services.roomService.getRoom(roomId);
      if (!room || room.gameState !== GameState.DISCUSSION || room.discussionLifecycle !== 'ACTIVE' || room.discussionEnforcementReady !== true) return;

      const inspection = this.botPolicy.consumeLastInspection(roomId);
      if (!inspection) {
        await this.simulateRandomBotChat(room);
        return;
      }

      const seerPlayer = room.players[inspection.seerTelegramId];
      if (!seerPlayer || !seerPlayer.alive || this.botPolicy.canSpeak(room, seerPlayer) !== 'ALLOW') return;

      const shouldClaim = this.botPolicy.shouldClaimInspection(
        inspection.seerTelegramId,
        inspection.revealedTeam,
      );
      if (shouldClaim) {
        const isWolf = inspection.revealedTeam === Team.WEREWOLF;
        this.botPolicy.addPublicSuspicion(roomId, inspection.targetTelegramId, isWolf ? 2 : -1);
        this.botPolicy.recordObservation(roomId, {
          type: isWolf ? 'ACCUSATION' : 'DISCUSSION',
          round: room.currentRound,
          actorTelegramId: inspection.seerTelegramId,
          targetTelegramId: inspection.targetTelegramId,
          text: 'seer-claim',
        });
        const claimText = `👁 [Tiên Tri] ${seerPlayer.nickname}: "${BotDialogue.seerClaim(
          inspection.targetNickname,
          inspection.revealedTeam,
        )}"`;
        await this.bot.telegram.sendMessage(room.chatId, claimText);
      } else {
        await this.simulateRandomBotChat(room);
      }

      setTimeout(async () => {
        const nextRoom = await this.services.roomService.getRoom(roomId);
        if (!nextRoom
          || nextRoom.gameState !== GameState.DISCUSSION
          || nextRoom.discussionLifecycle !== 'ACTIVE'
          || nextRoom.discussionEnforcementReady !== true
          || nextRoom.discussionCycleId !== room.discussionCycleId) return;
        const aliveBots = Object.values(nextRoom.players).filter(
          (player) => player.alive
            && isTestBot(player.telegramId)
            && player.telegramId !== inspection.seerTelegramId
            && this.botPolicy.canSpeak(nextRoom, player) === 'ALLOW',
        );
        if (aliveBots.length === 0) return;
        const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];
        const personality = this.botPolicy.getPersonality(randomBot.telegramId);
        const isWolf = inspection.revealedTeam === Team.WEREWOLF;
        const agrees = personality === 'aggressive'
          || (personality !== 'deceptive' && Math.random() < 0.65);
        const text = agrees && isWolf
          ? BotDialogue.reaction(
            randomBot.nickname,
            personality,
            inspection.targetNickname,
            inspection.revealedTeam,
          )
          : BotDialogue.claimReaction(randomBot.nickname);
        this.botPolicy.recordObservation(roomId, {
          type: agrees && isWolf ? 'ACCUSATION' : 'DEFENSE',
          round: nextRoom.currentRound,
          actorTelegramId: randomBot.telegramId,
          targetTelegramId: inspection.targetTelegramId,
          text: agrees ? 'supports-claim' : 'challenges-claim',
        });
        await this.safeSendMessage(nextRoom.chatId, text, undefined, 'discussion-bot-reaction');
      }, 2000);
    }, 3000);
  }

  private async simulateRandomBotChat(room: RoomState): Promise<void> {
    const aliveBots = Object.values(room.players).filter(
      (p) => p.alive && isTestBot(p.telegramId) && this.botPolicy.canSpeak(room, p) === 'ALLOW',
    );
    if (aliveBots.length === 0) return;
    const randomBot = aliveBots[Math.floor(Math.random() * aliveBots.length)];

    if (room.currentRound > 1 || Math.random() < 0.5) {
      const text = `💬 ${randomBot.nickname}: "${this.botPolicy.getPersonality(randomBot.telegramId) === 'quiet'
        ? BotDialogue.quiet()
        : BotDialogue.generic()}"`;
      this.botPolicy.recordObservation(room.id, {
        type: 'DISCUSSION',
        round: room.currentRound,
        actorTelegramId: randomBot.telegramId,
        text,
      });
      await this.safeSendMessage(room.chatId, text, undefined, 'discussion-bot-chat');
    }
  }

  /** Re-presents the current voting ballot when a user sends /vote after the
   * phase has already been opened. This is a user-facing recovery path for a
   * lost Telegram message; it does not mutate the ballot or create a second
   * timer. */
  async remindVoting(roomId: string): Promise<boolean> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room || room.gameState !== GameState.VOTING) return false;

    const aliveTargets: TargetOption[] = Object.values(room.players)
      .filter((p) => p.alive)
      .map((p) => ({ telegramId: p.telegramId, nickname: p.nickname }));
    const voteCounts: Record<string, number> = {};
    let skipCount = 0;
    for (const player of Object.values(room.players)) {
      if (!player.hasVotedThisRound) continue;
      if (player.voteTarget === null) skipCount += 1;
      else if (player.voteTarget) voteCounts[player.voteTarget] = (voteCounts[player.voteTarget] ?? 0) + 1;
    }

    await this.safeSendMessage(
      room.chatId,
      Messages.votingStarted(room.settings.timers.votingSeconds),
      buildVoteKeyboard({ targets: aliveTargets, voteCounts, skipCount, ballotId: room.ballotId }),
      'voting-reminder',
    );
    logger.info('Re-presented active voting ballot after /vote', {
      roomId,
      ballotId: room.ballotId,
      currentRound: room.currentRound,
    });
    return true;
  }

  /** Re-arms a missing timer for an active timed phase after restart or a
   * previously interrupted transition. This is intentionally a no-op when a
   * deadline already exists, so normal restart recovery does not duplicate
   * timers. */
  async ensurePhaseTimer(roomId: string): Promise<boolean> {
    const room = await this.services.roomService.getRoom(roomId);
    if (!room || ![
      GameState.FIRST_NIGHT,
      GameState.NIGHT,
      GameState.DISCUSSION,
      GameState.VOTING,
    ].includes(room.gameState)) return false;

    // A process restart may occur after the engine entered NIGHT but before
    // Telegram restrictions were applied. Reapply the group mute during the
    // same recovery pass that restores the phase timer.
    if (room.gameState === GameState.FIRST_NIGHT || room.gameState === GameState.NIGHT) {
      await this.muteService.mutePlayers(
        room.chatId,
        Object.values(room.players).map((player) => player.telegramId),
      );
    }

    const remainingMs = await this.services.timerService.getRemainingMs(roomId);
    if (remainingMs !== null) return false;

    const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
    if (!jobId) return false;
    activeTimerJobIds.set(room.id, jobId);
    logger.warn('Re-armed missing phase timer during runtime recovery', {
      roomId,
      gameState: room.gameState,
      nightPhase: room.nightPhase,
      currentRound: room.currentRound,
      jobId,
    });
    return true;
  }

  async startVoting(roomId: string): Promise<void> {
    // Validate and commit the phase transition first. If /vote is issued in
    // FIRST_NIGHT/NIGHT or another invalid phase, DayService must reject
    // without cancelling the timer that is responsible for advancing that
    // phase. Cancelling before this call caused an invalid /vote to remove the
    // active night timeout and left the room stuck indefinitely.
    const room = await this.services.dayService.startVoting(roomId);
    await this.cancelTimerIfAny(roomId);
    await this.presentVoting(room);
  }

  async onDiscussionDeathResolved(
    room: RoomState,
    deaths: Array<{ telegramId: string; cause: string }>,
  ): Promise<void> {
    await this.cancelTimerIfAny(room.id);

    // Discussion violations are resolved by the engine, but the Telegram
    // moderation path is separate. Persist every resulting death in the mute
    // set before presenting the next phase, otherwise a human who died for
    // speaking while silenced can continue sending messages after the flow
    // advances to voting. MuteService also attempts Telegram restrictions and
    // falls back to middleware deletion when the API cannot restrict them.
    if (deaths.length > 0) {
      await this.muteService.mutePlayers(room.chatId, deaths.map((death) => death.telegramId));
      await this.notifyDeadPlayersByDm(deaths, 'death-dm-discussion');
    }

    const firstDeath = deaths[0];
    if (firstDeath) {
      const nickname = room.players[firstDeath.telegramId]?.nickname ?? firstDeath.telegramId;
      await this.safeSendMessage(
        room.chatId,
        Messages.speechViolation(nickname),
        undefined,
        'speech-violation',
      );
    }
    if (room.gameState === GameState.GAME_OVER) {
      await this.announceGameOver(room);
      return;
    }
    await this.presentVoting(room);
  }

  private async presentVoting(room: RoomState): Promise<void> {
    const ballotKey = `${room.id}:${room.ballotId ?? `legacy-round-${room.currentRound}`}`;
    if (this.presentedBallotIds.has(ballotKey)) {
      logger.debug('Skipping duplicate voting presentation', { roomId: room.id, ballotId: room.ballotId });
      return;
    }
    this.presentedBallotIds.add(ballotKey);

    try {
      const seconds = room.settings.timers.votingSeconds;
      const aliveTargets: TargetOption[] = Object.values(room.players)
        .filter((p) => p.alive)
        .map((p) => ({ telegramId: p.telegramId, nickname: p.nickname }));

      await this.safeSendMessage(
        room.chatId,
        Messages.votingStarted(seconds),
        buildVoteKeyboard({ targets: aliveTargets, voteCounts: {}, skipCount: 0, ballotId: room.ballotId }),
        'voting-started',
      );

      const jobId = await this.services.orchestrator.scheduleCurrentPhaseTimer(room);
      if (jobId) activeTimerJobIds.set(room.id, jobId);

      for (const player of Object.values(room.players)) {
        if (!player.alive || !isTestBot(player.telegramId)) continue;
        await waitForBotTurn();
        const targetOption = this.botPolicy.chooseVoteTarget(room, player, aliveTargets, room.id);
        const targetTelegramId = targetOption?.telegramId ?? null;
        this.botPolicy.recordObservation(room.id, {
          type: 'VOTE',
          round: room.currentRound,
          actorTelegramId: player.telegramId,
          targetTelegramId,
        });
        try {
          await this.services.dayService.submitVote({
            roomId: room.id,
            actionId: `bot-vote-${player.telegramId}-${room.currentRound}-${targetTelegramId ?? 'SKIP'}`,
            voterTelegramId: player.telegramId,
            targetTelegramId,
            ballotId: room.ballotId,
          });
        } catch {
          // Timer resolves any missing bot vote.
        }
      }
      await this.resolveExecutionIfAllVoted(room.id);
    } catch (err) {
      this.presentedBallotIds.delete(ballotKey);
      throw err;
    }
  }

  private async resolveExecutionIfAllVoted(roomId: string): Promise<void> {
    // Fix #1: Guard against concurrent double-resolution. The same Set is used
    // in actionCallbackHandler so both entry points share one lock.
    if (resolvingExecutionRooms.has(roomId)) {
      logger.debug('resolveExecutionIfAllVoted: execution already in progress, skipping', { roomId });
      return;
    }
    const room = await this.services.roomService.getRoom(roomId);
    if (!room || room.gameState !== GameState.VOTING) return;
    const allVoted = Object.values(room.players)
      .filter((player) => player.alive)
      .every((player) => player.hasVotedThisRound);
    if (!allVoted) return;

    resolvingExecutionRooms.add(roomId);
    try {
      const { room: resolvedRoom, executedTelegramId, deaths } = await this.services.orchestrator.resolveExecution({
        roomId,
        promptHunter: (rid, hid) => this.promptHunterAndAwait(rid, hid),
      });
      await this.onExecutionResolved(resolvedRoom, executedTelegramId, deaths);
    } catch (err) {
      logger.error('resolveExecutionIfAllVoted: execution resolution failed', { roomId, err });
    } finally {
      resolvingExecutionRooms.delete(roomId);
    }
  }

  async onExecutionResolved(
    room: RoomState,
    executedTelegramId: string | null,
    deaths: Array<{ telegramId: string; cause: string }>,
  ): Promise<void> {
    await this.cancelTimerIfAny(room.id);

    if (deaths.length > 0) {
      await this.muteService.mutePlayers(room.chatId, deaths.map((d) => d.telegramId));
      await this.notifyDeadPlayersByDm(deaths, 'death-dm-execution');
    }

    const executedNickname = executedTelegramId
      ? (room.players[executedTelegramId]?.nickname ?? executedTelegramId)
      : null;
    const executedRole = executedTelegramId
      ? room.players[executedTelegramId]?.role ?? undefined
      : undefined;
    await this.safeSendMessage(
      room.chatId,
      Messages.executionResult(executedNickname, executedRole),
      undefined,
      'execution-result',
    );

    const extraDeaths = deaths.filter((d) => d.telegramId !== executedTelegramId);
    for (const death of extraDeaths) {
      const nickname = room.players[death.telegramId]?.nickname ?? death.telegramId;
      await this.safeSendMessage(
        room.chatId,
        `💀 ${nickname} đã ${DeathCauseNames[death.cause] ?? death.cause}.`,
        undefined,
        'execution-extra-death',
      );
    }

    if (room.gameState === GameState.GAME_OVER) {
      await this.announceGameOver(room);
      return;
    }

    await this.startNightPrompts(room);
  }

  private async announceGameOver(room: RoomState): Promise<void> {
    // Release player sessions at the terminal boundary before Telegram
    // presentation. A delivery failure or process restart must not force users
    // to revisit the old group and run /end before joining another match.
    await this.services.roomService.releaseTerminalPlayerSessions(room.id);

    const aliveWerewolves = Object.values(room.players).filter(
      (p) => p.alive && p.role === RoleId.WEREWOLF,
    ).length;
    const winner = aliveWerewolves === 0 ? 'VILLAGE' : 'WEREWOLF';
    await this.safeSendMessage(room.chatId, Messages.gameOver(winner), undefined, 'game-over');

    const finalRoles = Object.values(room.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        nickname: player.nickname,
        roleId: player.role ?? RoleId.VILLAGER,
      }));
    await this.safeSendMessage(room.chatId, Messages.finalRoleSummary(finalRoles), undefined, 'final-role-summary');

    // Game-over is a terminal boundary. Do not let failed Telegram
    // unrestriction leave a fallback marker that can affect a later session
    // in the same group.
    await this.muteService.unmuteAllPlayers(room.chatId, { clearFallbackOnFailure: true });

    // Clear per-room policy state after the match is complete.
    this.botPolicy.clearRoom(room.id);
  }

  private async cancelTimerIfAny(roomId: string): Promise<void> {
    const jobId = activeTimerJobIds.get(roomId);
    if (jobId) {
      await this.services.orchestrator.cancelCurrentPhaseTimer(roomId, jobId);
      activeTimerJobIds.delete(roomId);
    }
  }

  private async cleanupTimedOutSpecialRoles(room: RoomState): Promise<void> {
    const alivePlayers = Object.values(room.players).filter((p) => p.alive);
    for (const player of alivePlayers) {
      // Werewolf timeout is handled separately by cleanupTimedOutWerewolves
      // to respect the pack-consensus mechanic (no individual DM for wolves).
      if (!player.role || player.role === RoleId.WITCH || player.role === RoleId.WEREWOLF) continue;
      const actionType = ROLE_NIGHT_ACTION[player.role];
      if (!actionType) continue;

      const submitted = room.pendingNightActions.some(
        (action) =>
          action.actorTelegramId === player.telegramId &&
          action.actionType === actionType &&
          action.round === room.currentRound,
      );

      if (!submitted) {
        const key = `prompt-message:${room.id}:${player.telegramId}`;
        const messageId = await this.services.redis.get(key);
        if (messageId) {
          await this.bot.telegram
            .editMessageReplyMarkup(player.telegramId, Number(messageId), undefined, {
              inline_keyboard: [],
            })
            .catch(() => undefined);
          await this.services.redis.del(key);
        }
        await this.bot.telegram
          .sendMessage(
            player.telegramId,
            `⏳ Hết thời gian thực hiện hành động! Lựa chọn của bạn đã được tính là Bỏ qua (Skip).`,
          )
          .catch(() => undefined);
      }
    }
  }

  /**
   * Handles timeout cleanup specifically for the Werewolf faction, respecting
   * the pack-consensus mechanic:
   *
   * - When ≥ 2 wolves are alive: silently closes all wolf keyboards that are
   *   still open (no individual timeout DM). The engine will treat missing
   *   votes as "no consensus → no kill". A team-wide no-consensus notice is
   *   sent to all wolves via notifyWerewolfNoConsensus.
   *
   * - When exactly 1 wolf is alive: closes the keyboard and sends the normal
   *   individual timeout DM, consistent with solo-role timeout behaviour.
   */
  private async cleanupTimedOutWerewolves(room: RoomState): Promise<void> {
    const aliveWerewolves = Object.values(room.players).filter(
      (p) => p.alive && p.role === RoleId.WEREWOLF,
    );
    if (aliveWerewolves.length === 0) return;

    const isSoloWolf = aliveWerewolves.length === 1;

    for (const wolf of aliveWerewolves) {
      const key = `prompt-message:${room.id}:${wolf.telegramId}`;
      const messageId = await this.services.redis.get(key);
      if (messageId) {
        await this.bot.telegram
          .editMessageReplyMarkup(wolf.telegramId, Number(messageId), undefined, {
            inline_keyboard: [],
          })
          .catch(() => undefined);
        await this.services.redis.del(key);
      }

      if (isSoloWolf) {
        // Solo wolf: send the standard individual timeout message.
        await this.bot.telegram
          .sendMessage(
            wolf.telegramId,
            `⏳ Hết thời gian thực hiện hành động! Lựa chọn của bạn đã được tính là Bỏ qua (Skip).`,
          )
          .catch(() => undefined);
      }
    }

    if (!isSoloWolf) {
      // Pack of wolves: send the team-wide no-consensus notice to every wolf.
      // notifyWerewolfNoConsensus already checks whether consensus was actually
      // reached and skips sending if it was (e.g. all wolves agreed before timeout).
      await this.notifyWerewolfNoConsensus(room);
    }
  }

  private async cleanupTimedOutWitch(room: RoomState): Promise<void> {
    const witch = Object.values(room.players).find((p) => p.alive && p.role === RoleId.WITCH);
    if (!witch) return;

    const submittedSave = room.pendingNightActions.some(
      (a) =>
        a.actorTelegramId === witch.telegramId &&
        a.actionType === NightActionType.WITCH_SAVE &&
        a.round === room.currentRound,
    );
    const submittedPoison = room.pendingNightActions.some(
      (a) =>
        a.actorTelegramId === witch.telegramId &&
        a.actionType === NightActionType.WITCH_POISON &&
        a.round === room.currentRound,
    );

    let notified = false;
    if (!submittedSave) {
      const key = `witch-save-message:${room.id}:${witch.telegramId}`;
      const messageId = await this.services.redis.get(key);
      if (messageId) {
        await this.bot.telegram
          .editMessageReplyMarkup(witch.telegramId, Number(messageId), undefined, {
            inline_keyboard: [],
          })
          .catch(() => undefined);
        await this.services.redis.del(key);
      }
      notified = true;
    }

    if (!submittedPoison) {
      const key = `witch-poison-message:${room.id}:${witch.telegramId}`;
      const messageId = await this.services.redis.get(key);
      if (messageId) {
        await this.bot.telegram
          .editMessageReplyMarkup(witch.telegramId, Number(messageId), undefined, {
            inline_keyboard: [],
          })
          .catch(() => undefined);
        await this.services.redis.del(key);
      }
      notified = true;
    }

    if (notified) {
      await this.bot.telegram
        .sendMessage(
          witch.telegramId,
          `⏳ Hết thời gian thực hiện hành động! Lựa chọn của bạn đã được tính là Bỏ qua (Skip).`,
        )
        .catch(() => undefined);
    }
  }

  /** Registers the BullMQ timeout handlers for all three timed phases. Each
   * handler is defensive: it re-checks the room's current state before
   * acting, since a timer could theoretically fire after the phase already
   * advanced via early resolution (all players acted before the deadline). */
  registerTimeoutHandlers(): void {
    this.services.timerService.onTimeout(TimerJobType.NIGHT_ACTION_TIMEOUT, async (roomId, payload) => {
      const room = await this.services.roomService.getRoom(roomId);
      const expectedRound = typeof payload.round === 'number' ? payload.round : null;
      const expectedNightPhase = typeof payload.nightPhase === 'string' ? payload.nightPhase : null;
      if (!room) return;
      if (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT) return;
      if (
        expectedRound !== room.currentRound
        || expectedNightPhase !== (room.nightPhase ?? NightPhase.ACTIONS)
      ) {
        logger.debug('Ignoring stale night timeout', {
          roomId,
          expectedRound,
          currentRound: room.currentRound,
          expectedNightPhase,
          currentNightPhase: room.nightPhase ?? NightPhase.ACTIONS,
        });
        return;
      }

      if (room.nightPhase !== NightPhase.WITCH) {
        // Cleanup timed-out keyboards and notify players for non-Witch, non-Werewolf roles.
        await this.cleanupTimedOutSpecialRoles(room);
        // Handle Werewolf timeout separately to respect the pack-consensus mechanic.
        await this.cleanupTimedOutWerewolves(room);
        await this.beginWitchPhase(roomId);
        return;
      }

      // Fallback path: if NIGHT_ACTION_TIMEOUT fired but nightPhase is already WITCH,
      // it means the Witch timed out
      await this.cleanupTimedOutWitch(room);

      await this.resolveNight(roomId);
    });

    this.services.timerService.onTimeout(TimerJobType.WITCH_ACTION_TIMEOUT, async (roomId, payload) => {
      const room = await this.services.roomService.getRoom(roomId);
      const expectedRound = typeof payload.round === 'number' ? payload.round : null;
      if (
        !room
        || (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT)
        || room.nightPhase !== NightPhase.WITCH
      ) return;
      if (expectedRound !== room.currentRound) {
        logger.debug('Ignoring stale witch timeout', {
          roomId,
          expectedRound,
          currentRound: room.currentRound,
        });
        return;
      }

      // Witch timed out during Witch phase
      await this.cleanupTimedOutWitch(room);

      await this.resolveNight(roomId);
    });

    this.services.timerService.onTimeout(TimerJobType.DISCUSSION_TIMEOUT, async (roomId, payload) => {
      const room = await this.services.roomService.getRoom(roomId);
      const expectedCycleId = typeof payload.discussionCycleId === 'string' ? payload.discussionCycleId : null;
      if (!room || room.gameState !== GameState.DISCUSSION) return;
      if (room.discussionLifecycle !== 'ACTIVE' || room.discussionEnforcementReady !== true) return;
      if (expectedCycleId !== room.discussionCycleId) {
        logger.debug('Ignoring stale discussion timeout', { roomId, expectedCycleId, currentCycleId: room.discussionCycleId });
        return;
      }
      try {
        await this.startVoting(roomId);
      } catch (err) {
        logger.debug('Discussion timeout lost a phase race; treating as stale', { roomId, err });
      }
    });

    this.services.timerService.onTimeout(TimerJobType.VOTING_TIMEOUT, async (roomId, payload) => {
      const room = await this.services.roomService.getRoom(roomId);
      const expectedBallotId = typeof payload.ballotId === 'string' ? payload.ballotId : null;
      const expectedRound = typeof payload.round === 'number' ? payload.round : null;
      if (!room || room.gameState !== GameState.VOTING) return;
      if (expectedBallotId !== room.ballotId || expectedRound !== room.currentRound) {
        logger.debug('Ignoring stale voting timeout', { roomId, expectedBallotId, currentBallotId: room.ballotId, expectedRound, currentRound: room.currentRound });
        return;
      }
      await this.resolveExecution(roomId);
    });
  }
}
