import { StoragePort } from './ports/StoragePort';
import { createHash } from 'crypto';
import { ClockPort } from './ports/ClockPort';
import { EventBus } from './events/EventBus';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { DomainEventType, GameState, DeathCause, WinnerTeam } from './domain/enums';
import { RoomState } from './domain/Room';
import { killPlayer, resetVote } from './domain/Player';
import { VoteResolver, VoteSubmission } from './voting/VoteResolver';
import { DeathQueue } from './night/DeathQueue';
import { WinConditionChecker } from './win-condition/WinConditionChecker';
import { GameStateMachine } from './state-machine/GameStateMachine';
import {
  RoomNotFoundError,
  DeadPlayerActionError,
  InvalidPhaseActionError,
  InvalidTargetError,
  DuplicateActionError,
  StaleBallotError,
  ConcurrentModificationError,
  PlayerNotInRoomError,
  StaleResolutionError,
} from './errors/DomainError';

const MAX_OPTIMISTIC_RETRY = 10;
const ACTION_ID_TTL_SECONDS = 60 * 30;

/**
 * Telegram callback_data is limited to 64 UTF-8 bytes. A ballot identifier
 * must still distinguish rounds and match instances for stale-callback
 * protection, but must not embed the full chat/match/speech identifier in
 * every button. The room id, match id, round and next committed version form
 * the identity; a compact digest keeps the resulting callback payload small.
 */
function createCompactBallotId(room: RoomState): string {
  const nextVersion = room.version + 1;
  const identity = `${room.id}|${room.matchId ?? ''}|${room.currentRound}|${nextVersion}`;
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `b-${digest}-r${room.currentRound}-v${nextVersion}`;
}

/**
 * Application service orchestrating the day cycle (SRS section 5: DAY ->
 * DISCUSSION -> VOTING -> EXECUTION -> CHECK_WIN). Mirrors NightActionService's
 * shape/conventions (optimistic-retry mutate closures, idempotency guard for
 * vote submissions, event emission) so the two "phase services" feel
 * consistent to maintain, even though voting and night-actions have distinct
 * business rules.
 *
 * Phase responsibilities:
 *   - startDiscussion: DAY -> DISCUSSION (a simple timer phase with no
 *     player-submitted actions -- pure bookkeeping transition + event so the
 *     Telegram layer knows to start the discussion timer).
 *   - startVoting: DAY/DISCUSSION -> VOTING; DAY is the recovery/intermediate
 *     early-skip path and DISCUSSION is the normal daytime skip path.
 *   - submitVote: anti-cheat validated vote submission during VOTING.
 *   - resolveExecution: tallies votes (VoteResolver), applies the execution
 *     (including Hunter revenge via DeathQueue if the executed player is a
 *     Hunter and VOTE_EXECUTION is in hunterTriggerCauses), transitions
 *     VOTING -> EXECUTION -> CHECK_WIN, then either GAME_OVER (win condition
 *     met) or NIGHT (advancing currentRound for the next night).
 */
export class DayService {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
    private readonly eventBus: EventBus,
    private readonly stateMachine: GameStateMachine,
  ) {}

  private stampCommitVersion(events: DomainEvent[], roomVersion: number): DomainEvent[] {
    return events.map((event) => ({ ...event, commitVersion: roomVersion }));
  }

  private async withRetry(
    roomId: string,
    mutate: (room: RoomState) => { room: RoomState; events: DomainEvent[] },
  ): Promise<{ room: RoomState; events: DomainEvent[] }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRY; attempt++) {
      const room = await this.storage.getRoom(roomId);
      if (!room) {
        throw new RoomNotFoundError(roomId);
      }
      try {
        const { room: mutated, events } = mutate(room);
        const saved = await this.storage.saveRoom(mutated, room.version);
        return { room: saved, events };
      } catch (err) {
        if (err instanceof ConcurrentModificationError) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Optimistic retry exhausted');
  }

  /** DAY -> DISCUSSION. Opens the persisted discussion lifecycle with enforcement disabled. */
  async startDiscussion(roomId: string): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(roomId, (room) => {
      if (room.gameState !== GameState.DAY) {
        throw new InvalidPhaseActionError('DISCUSSION', room.gameState);
      }
      const target = this.stateMachine.assertTransition(room.gameState, GameState.DISCUSSION);
      const discussionCycleId = `${room.matchId ?? room.id}:discussion:${room.currentRound}:${now}`;
      const updated: RoomState = {
        ...room,
        gameState: target,
        discussionLifecycle: 'OPENING',
        discussionCycleId,
        discussionEnforcementReady: false,
        discussionAnnouncementSentAt: null,
        discussionDeadlineAt: null,
        silencedDiscussionCycleId: null,
        updatedAt: now,
      };
      const events: DomainEvent[] = [
        createEvent({
          type: DomainEventType.PHASE_CHANGED,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: { from: GameState.DAY, to: target, discussionCycleId },
        }, now),
      ];
      return { room: updated, events };
    });
    const committedEvents = this.stampCommitVersion(events, room.version);
    if (room.matchId) await this.storage.appendEvents(room.matchId, committedEvents);
    await this.eventBus.publishAll(committedEvents);
    return room;
  }

  /** Activates the discussion gate only after the public announcement succeeds. */
  async activateDiscussion(roomId: string, discussionCycleId: string): Promise<RoomState> {
    const now = this.clock.now();
    const { room } = await this.withRetry(roomId, (latest) => {
      if (latest.gameState !== GameState.DISCUSSION || latest.discussionLifecycle !== 'OPENING') {
        throw new InvalidPhaseActionError('DISCUSSION_ACTIVATE', latest.gameState);
      }
      if (latest.discussionCycleId !== discussionCycleId) {
        throw new InvalidPhaseActionError('STALE_DISCUSSION_CYCLE', latest.gameState);
      }
      const players = Object.fromEntries(Object.entries(latest.players).map(([id, player]) => [id, {
        ...player,
        silencedDiscussionCycleId: latest.silencedPlayerId === id && latest.silencedUntilRound === latest.currentRound
          ? discussionCycleId
          : player.silencedDiscussionCycleId,
      }]));
      const discussionDeadlineAt = now + latest.settings.timers.discussionSeconds * 1000;
      return {
        room: {
          ...latest,
          players,
          discussionLifecycle: 'ACTIVE',
          discussionEnforcementReady: true,
          discussionAnnouncementSentAt: now,
          discussionDeadlineAt,
          silencedDiscussionCycleId: latest.silencedPlayerId && latest.silencedUntilRound === latest.currentRound
            ? discussionCycleId
            : null,
          updatedAt: now,
        },
        events: [],
      };
    });
    return room;
  }

  /** DAY/DISCUSSION -> VOTING. Closes any discussion gate before voting starts. */
  async startVoting(roomId: string): Promise<RoomState> {
    const room = await this.transitionFromDayOrDiscussion(roomId, GameState.VOTING);
    const now = this.clock.now();
    const { room: closed } = await this.withRetry(roomId, (latest) => {
      if (latest.gameState !== GameState.VOTING) {
        throw new InvalidPhaseActionError('VOTING', latest.gameState);
      }
      const players = Object.fromEntries(Object.entries(latest.players).map(([id, player]) => [id, {
        ...player,
        silencedUntilRound: null,
        silencedDiscussionCycleId: null,
      }]));
      return {
        room: {
          ...latest,
          players,
          discussionLifecycle: 'CLOSED',
          discussionEnforcementReady: false,
          discussionDeadlineAt: null,
          silencedPlayerId: null,
          silencedUntilRound: null,
          silencedDiscussionCycleId: null,
          ballotId: createCompactBallotId(latest),
          updatedAt: now,
        },
        events: [],
      };
    });
    void room;
    return closed;
  }

  /**
   * Resolves one accepted speech attempt from an active silenced player.
   * The operation is idempotent by speechEventId and commits death, win check,
   * phase transition and events under one optimistic-lock retry boundary.
   */
  async resolveDiscussionSpeechViolation(params: {
    roomId: string;
    speechEventId: string;
    speakerTelegramId: string;
    chatId: string;
    messageKind: string;
    receivedAt?: number;
    hunterPrompt?: (hunterTelegramId: string) => Promise<{ targetTelegramId: string | null }>;
  }): Promise<{
    room: RoomState;
    accepted: boolean;
    reason?: string;
    winner: WinnerTeam;
    deaths: Array<{ telegramId: string; cause: string }>;
  }> {
    const isNew = await this.storage.recordActionIdIfNew(params.roomId, params.speechEventId, ACTION_ID_TTL_SECONDS);
    if (!isNew) {
      throw new DuplicateActionError(params.speechEventId);
    }

    const initialRoom = await this.storage.getRoom(params.roomId);
    if (!initialRoom) throw new RoomNotFoundError(params.roomId);
    let hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    const initialSpeaker = initialRoom.players[params.speakerTelegramId];
    const initialIsSilenced = initialRoom.gameState === GameState.DISCUSSION
      && initialRoom.discussionLifecycle === 'ACTIVE'
      && initialRoom.discussionEnforcementReady === true
      && initialRoom.silencedPlayerId === params.speakerTelegramId
      && initialRoom.silencedUntilRound === initialRoom.currentRound
      && initialRoom.silencedDiscussionCycleId === initialRoom.discussionCycleId;
    if (initialIsSilenced && initialSpeaker?.alive && params.hunterPrompt) {
      const deathQueue = new DeathQueue();
      const queueResult = deathQueue.resolveOriginalDeaths(
        [{ telegramId: params.speakerTelegramId, cause: DeathCause.SPOKEN_WHILE_SILENCED }],
        initialRoom.players,
        initialRoom.settings.hunterTriggerCauses as DeathCause[],
      );
      for (const hunterId of queueResult.pendingHunterTelegramIds) {
        hunterDecisions[hunterId] = await params.hunterPrompt(hunterId).catch(() => ({ targetTelegramId: null }));
      }
    }

    const now = this.clock.now();
    let capturedDeaths: Array<{ telegramId: string; cause: string }> = [];
    let capturedWinner: WinnerTeam = WinnerTeam.NONE;
    let accepted = false;
    let rejectionReason: string | undefined;

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      // Reset captured side effects on every optimistic-lock attempt. A failed
      // attempt must never leak `accepted=true` or deaths into a later retry.
      accepted = false;
      rejectionReason = undefined;
      capturedDeaths = [];
      capturedWinner = WinnerTeam.NONE;

      const hasHunterDecision = Object.keys(hunterDecisions).length > 0;
      if (hasHunterDecision && (
        room.version !== initialRoom.version
        || room.gameState !== GameState.DISCUSSION
        || room.discussionCycleId !== initialRoom.discussionCycleId
      )) {
        throw new InvalidPhaseActionError('STALE_HUNTER_PROMPT', room.gameState);
      }

      const speaker = room.players[params.speakerTelegramId];
      const isActive = room.gameState === GameState.DISCUSSION
        && room.discussionLifecycle === 'ACTIVE'
        && room.discussionEnforcementReady === true;
      const isSilenced = room.silencedPlayerId === params.speakerTelegramId
        && room.silencedUntilRound === room.currentRound
        && room.silencedDiscussionCycleId === room.discussionCycleId;
      const isSpeech = ['TEXT', 'VOICE', 'STICKER', 'GIF', 'ANIMATION'].includes(params.messageKind);

      if (room.chatId !== params.chatId) rejectionReason = 'CHAT_MISMATCH';
      else if (!isActive) rejectionReason = 'NOT_READY_OR_STALE_PHASE';
      else if (!speaker) rejectionReason = 'PLAYER_NOT_IN_ROOM';
      else if (!speaker.alive) rejectionReason = 'PLAYER_ALREADY_DEAD';
      else if (!isSpeech) rejectionReason = 'INVALID_MESSAGE_KIND';
      else if (!isSilenced) rejectionReason = 'NOT_SILENCED';

      if (rejectionReason) {
        return { room, events: [] };
      }

      const deathQueue = new DeathQueue();
      const depth0 = [{ telegramId: params.speakerTelegramId, cause: DeathCause.SPOKEN_WHILE_SILENCED }];
      const queueResult = deathQueue.resolveOriginalDeaths(depth0, room.players, room.settings.hunterTriggerCauses as DeathCause[]);
      const { resolved } = queueResult;
      const decisions = Object.fromEntries(queueResult.pendingHunterTelegramIds.map((hunterId) => {
        const decision = hunterDecisions[hunterId];
        return [hunterId, decision ? { hunterTelegramId: hunterId, targetTelegramId: decision.targetTelegramId } : null];
      }));
      const resolvedDeaths = deathQueue.applyHunterDecisions(
        resolved,
        room.players,
        decisions,
      );
      let updatedPlayers = { ...room.players };
      for (const death of resolvedDeaths) {
        const player = updatedPlayers[death.telegramId];
        if (player?.alive) updatedPlayers[death.telegramId] = killPlayer(player, death.cause, room.currentRound);
      }
      const afterDeaths: RoomState = {
        ...room,
        players: updatedPlayers,
        silencedPlayerId: null,
        silencedUntilRound: null,
        silencedDiscussionCycleId: null,
      };
      const win = new WinConditionChecker().check(afterDeaths);
      capturedWinner = win.winner as WinnerTeam;
      this.stateMachine.assertTransition(GameState.DISCUSSION, GameState.CHECK_WIN);
      capturedDeaths = resolvedDeaths.map((death) => ({ telegramId: death.telegramId, cause: death.cause }));
      accepted = true;

      const phaseEvents: DomainEvent[] = [
        createEvent({
          type: DomainEventType.SPEECH_VIOLATION,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: { speechEventId: params.speechEventId, speakerTelegramId: params.speakerTelegramId, messageKind: params.messageKind },
        }, now),
        ...resolvedDeaths.map((death) => createEvent({
          type: DomainEventType.PLAYER_DIED,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: { telegramId: death.telegramId, cause: death.cause, role: updatedPlayers[death.telegramId]?.role ?? 'UNKNOWN' },
        }, now)),
        createEvent({
          type: DomainEventType.PHASE_CHANGED,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: { from: GameState.DISCUSSION, to: GameState.CHECK_WIN },
        }, now),
      ];

      let finalState: GameState = GameState.CHECK_WIN;
      if (win.winner !== WinnerTeam.NONE) {
        this.stateMachine.assertTransition(GameState.CHECK_WIN, GameState.GAME_OVER);
        phaseEvents.push(
          createEvent({ type: DomainEventType.WIN_CONDITION_MET, roomId: room.id, matchId: room.matchId, round: room.currentRound,
            payload: { winner: win.winner, aliveWerewolves: win.aliveWerewolves, aliveVillagers: win.aliveVillagers } }, now),
          createEvent({ type: DomainEventType.PHASE_CHANGED, roomId: room.id, matchId: room.matchId, round: room.currentRound,
            payload: { from: GameState.CHECK_WIN, to: GameState.GAME_OVER } }, now),
          createEvent({ type: DomainEventType.GAME_ENDED, roomId: room.id, matchId: room.matchId, round: room.currentRound,
            payload: { winner: win.winner } }, now),
        );
        finalState = GameState.GAME_OVER;
      } else {
        this.stateMachine.assertTransition(GameState.CHECK_WIN, GameState.VOTING);
        phaseEvents.push(createEvent({ type: DomainEventType.PHASE_CHANGED, roomId: room.id, matchId: room.matchId, round: room.currentRound,
          payload: { from: GameState.CHECK_WIN, to: GameState.VOTING } }, now));
        finalState = GameState.VOTING;
      }

      return {
        room: {
          ...afterDeaths,
          gameState: finalState,
          discussionLifecycle: 'CLOSED',
          discussionEnforcementReady: false,
          discussionDeadlineAt: null,
          ballotId: finalState === GameState.VOTING
            ? createCompactBallotId(room)
            : null,
          updatedAt: now,
        },
        events: phaseEvents,
      };
    });

    const committedEvents = this.stampCommitVersion(events, room.version);
    if (room.matchId) await this.storage.appendEvents(room.matchId, committedEvents);
    await this.eventBus.publishAll(committedEvents);
    return { room, accepted, reason: rejectionReason, winner: capturedWinner, deaths: capturedDeaths };
  }

  private async transitionFromDayOrDiscussion(
    roomId: string,
    to: GameState,
  ): Promise<RoomState> {
    return this.transitionFromStates(roomId, [GameState.DAY, GameState.DISCUSSION], to);
  }

  private async transitionFromStates(
    roomId: string,
    expectedFrom: GameState[],
    to: GameState,
  ): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(roomId, (room) => {
      if (!expectedFrom.includes(room.gameState)) {
        throw new InvalidPhaseActionError(`transition to ${to}`, room.gameState);
      }
      const from = room.gameState;
      const target = this.stateMachine.assertTransition(from, to);
      const updated: RoomState = { ...room, gameState: target, updatedAt: now };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: { from, to: target },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    const committedEvents = this.stampCommitVersion(events, room.version);
    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, committedEvents);
    }
    await this.eventBus.publishAll(committedEvents);
    return room;
  }

  /**
   * Submits a single player's execution vote. Anti-cheat enforcement
   * mirrors NightActionService.submitNightAction:
   *   1. Player must exist and be alive (dead players cannot vote -- SRS
   *      section 11).
   *   2. Room must be in VOTING phase.
   *   3. Target (if not abstaining) must be a living player. Self-voting is
   *      allowed -- matching common Werewolf house rules; SRS does not
   *      prohibit it and forbidding it would be an unrequested restriction.
   *   4. Idempotency check via actionId, same mechanism as night actions.
   *
   * Each player may submit only one vote per round. A second submission
   * from the same player in the same round is rejected, including explicit
   * abstains, so the choice is locked once made.
   */
  async submitVote(params: {
    roomId: string;
    actionId: string;
    voterTelegramId: string;
    targetTelegramId: string | null;
    ballotId?: string | null;
  }): Promise<RoomState> {
    const now = this.clock.now();

    const isNew = await this.storage.recordActionIdIfNew(
      params.roomId,
      params.actionId,
      ACTION_ID_TTL_SECONDS,
    );
    if (!isNew) {
      throw new DuplicateActionError(params.actionId);
    }

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      const voter = room.players[params.voterTelegramId];
      if (!voter) {
        throw new PlayerNotInRoomError(params.voterTelegramId);
      }
      if (!voter.alive) {
        throw new DeadPlayerActionError(params.voterTelegramId);
      }
      if (room.gameState !== GameState.VOTING) {
        throw new InvalidPhaseActionError('VOTE_CAST', room.gameState);
      }
      // `undefined` is reserved for trusted internal/service callers that do
      // not originate from a Telegram keyboard. Callback handlers always pass
      // either the parsed ballotId or null, so legacy/stale callbacks remain
      // rejectable without breaking direct command/service tests.
      if (room.ballotId && params.ballotId !== undefined && params.ballotId !== room.ballotId) {
        throw new StaleBallotError(room.ballotId, params.ballotId ?? null);
      }
      if (params.targetTelegramId !== null) {
        const target = room.players[params.targetTelegramId];
        if (!target || !target.alive) {
          throw new InvalidTargetError('Vote target must be a living player');
        }
      }

      if (voter.hasVotedThisRound) {
        throw new DuplicateActionError(params.actionId);
      }

      const updatedPlayers = {
        ...room.players,
        [params.voterTelegramId]: {
          ...voter,
          voteTarget: params.targetTelegramId,
          hasVotedThisRound: true,
        },
      };

      const updated: RoomState = { ...room, players: updatedPlayers, updatedAt: now };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.VOTE_CAST,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: {
              telegramId: params.voterTelegramId,
              targetId: params.targetTelegramId,
            },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    const committedEvents = this.stampCommitVersion(events, room.version);
    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, committedEvents);
    }
    await this.eventBus.publishAll(committedEvents);
    return room;
  }

  /**
   * Tallies all votes cast, applies the execution (with Hunter revenge
   * chaining via DeathQueue), checks the win condition, and transitions
   * VOTING -> EXECUTION -> CHECK_WIN -> (GAME_OVER | NIGHT for next round).
   *
   * Uses each living player's `voteTarget` field (set by submitVote) as the
   * source of truth rather than a separate submissions list -- since exactly
   * one vote per living player can exist at a time (last-submission-wins),
   * `voteTarget` IS the current tally input; no separate pending-votes queue
   * is needed the way pendingNightActions is needed for potentially-multiple
   * per-round night actions (Witch's two potions).
   */
  /**
   * Step 1 of the split execution-resolution flow: tallies votes and
   * determines whether the executed player (if any) is a Hunter who needs
   * to be prompted for a revenge shot, WITHOUT mutating any room/player
   * state or transitioning the state machine yet. Mirrors
   * NightActionService.prepareNightResolution/finalizeNightResolution for
   * the same reason: prompting a Hunter over Telegram is asynchronous and
   * cannot be modeled as a synchronous callback invoked mid-resolve.
   */
  async prepareExecutionResolution(roomId: string): Promise<{
    room: RoomState;
    roomVersion: number;
    executedTelegramId: string | null;
    voteCounts: Record<string, number>;
    pendingHunterTelegramIds: string[];
    depth0Deaths: Array<{ telegramId: string; cause: DeathCause }>;
  }> {
    const room = await this.storage.getRoom(roomId);
    if (!room) {
      throw new RoomNotFoundError(roomId);
    }
    if (room.gameState !== GameState.VOTING) {
      throw new InvalidPhaseActionError('EXECUTION_RESOLVED', room.gameState);
    }

    const voteResolver = new VoteResolver();
    const alivePlayers = Object.values(room.players).filter((p) => p.alive);
    const submissions: VoteSubmission[] = alivePlayers
      // A null target only represents Skip after the player has explicitly voted.
      // Players who have not voted do not affect the result.
      .filter((p) => p.hasVotedThisRound)
      .map((p) => ({
        voterTelegramId: p.telegramId,
        targetTelegramId: p.voteTarget,
      }));
    const voteResult = voteResolver.resolve(submissions);

    const depth0Deaths: Array<{ telegramId: string; cause: DeathCause }> = [];
    if (voteResult.executedTelegramId) {
      depth0Deaths.push({
        telegramId: voteResult.executedTelegramId,
        cause: DeathCause.VOTE_EXECUTION,
      });
    }

    const deathQueue = new DeathQueue();
    const { pendingHunterTelegramIds } = deathQueue.resolveOriginalDeaths(
      depth0Deaths,
      room.players,
      room.settings.hunterTriggerCauses as DeathCause[],
    );

    return {
      room,
      roomVersion: room.version,
      executedTelegramId: voteResult.executedTelegramId,
      voteCounts: voteResult.voteCounts,
      pendingHunterTelegramIds,
      depth0Deaths,
    };
  }

  /**
   * Step 2: applies the collected Hunter revenge decisions, finalizes all
   * death/room-state changes, checks the win condition, and transitions
   * VOTING -> EXECUTION -> CHECK_WIN -> (GAME_OVER | NIGHT for next round).
   */
  async finalizeExecutionResolution(params: {
    roomId: string;
    roomVersion: number;
    executedTelegramId: string | null;
    voteCounts: Record<string, number>;
    depth0Deaths: Array<{ telegramId: string; cause: DeathCause }>;
    hunterDecisions: Record<string, { targetTelegramId: string | null } | null>;
  }): Promise<{
    room: RoomState;
    executedTelegramId: string | null;
    deaths: Array<{ telegramId: string; cause: string }>;
  }> {
    const now = this.clock.now();
    const winChecker = new WinConditionChecker();

    let capturedDeaths: Array<{ telegramId: string; cause: string }> = [];

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (room.version !== params.roomVersion) {
        throw new StaleResolutionError(params.roomId, params.roomVersion, room.version);
      }
      if (room.gameState !== GameState.VOTING) {
        throw new InvalidPhaseActionError('EXECUTION_RESOLVED', room.gameState);
      }

      const deathQueue = new DeathQueue();
      let updatedPlayers = { ...room.players };
      const decisionsWithHunterId: Record<
        string,
        { hunterTelegramId: string; targetTelegramId: string | null } | null
      > = {};
      for (const [hunterId, decision] of Object.entries(params.hunterDecisions)) {
        decisionsWithHunterId[hunterId] = decision
          ? { hunterTelegramId: hunterId, targetTelegramId: decision.targetTelegramId }
          : null;

        const hunterPlayer = updatedPlayers[hunterId];
        if (!hunterPlayer || !decision || decision.targetTelegramId === null) continue;
        updatedPlayers[hunterId] = {
          ...hunterPlayer,
          hunterRevengeTarget: decision.targetTelegramId,
        };
      }

      const { resolved: depth0Resolved } = deathQueue.resolveOriginalDeaths(
        params.depth0Deaths,
        updatedPlayers,
        room.settings.hunterTriggerCauses as DeathCause[],
      );

      const resolvedDeaths = deathQueue.applyHunterDecisions(
        depth0Resolved,
        updatedPlayers,
        decisionsWithHunterId,
      );
      capturedDeaths = resolvedDeaths.map((d) => ({
        telegramId: d.telegramId,
        cause: d.cause,
      }));

      for (const death of resolvedDeaths) {
        const player = updatedPlayers[death.telegramId];
        if (!player || !player.alive) continue;
        updatedPlayers[death.telegramId] = killPlayer(player, death.cause, room.currentRound);
      }
      updatedPlayers = Object.fromEntries(
        Object.entries(updatedPlayers).map(([id, p]) => [id, resetVote(p)]),
      );

      const deathEvents: DomainEvent[] = resolvedDeaths.map((d) =>
        createEvent(
          {
            type: DomainEventType.PLAYER_DIED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: {
              telegramId: d.telegramId,
              cause: d.cause,
              role: updatedPlayers[d.telegramId]?.role ?? 'UNKNOWN',
            },
          },
          now,
        ),
      );

      const executionEvent = createEvent(
        {
          type: DomainEventType.EXECUTION_RESOLVED,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: {
            executedTelegramId: params.executedTelegramId,
            voteCounts: params.voteCounts,
          },
        },
        now,
      );

      const phaseEvents: DomainEvent[] = [];
      let gameState: GameState = room.gameState;

      const toExecution = this.stateMachine.assertTransition(gameState, GameState.EXECUTION);
      phaseEvents.push(
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: { from: gameState, to: toExecution },
          },
          now,
        ),
      );
      gameState = toExecution;

      const toCheckWin = this.stateMachine.assertTransition(gameState, GameState.CHECK_WIN);
      phaseEvents.push(
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: { from: gameState, to: toCheckWin },
          },
          now,
        ),
      );
      gameState = toCheckWin;

      const roomAfterDeaths: RoomState = { ...room, players: updatedPlayers };
      const winCheck = winChecker.check(roomAfterDeaths);

      let finalGameState: GameState;
      let nextRound = room.currentRound;
      const endgameEvents: DomainEvent[] = [];

      if (winCheck.winner !== 'NONE') {
        const toGameOver = this.stateMachine.assertTransition(gameState, GameState.GAME_OVER);
        endgameEvents.push(
          createEvent(
            {
              type: DomainEventType.WIN_CONDITION_MET,
              roomId: room.id,
              matchId: room.matchId,
              round: room.currentRound,
              payload: {
                winner: winCheck.winner,
                aliveWerewolves: winCheck.aliveWerewolves,
                aliveVillagers: winCheck.aliveVillagers,
              },
            },
            now,
          ),
          createEvent(
            {
              type: DomainEventType.PHASE_CHANGED,
              roomId: room.id,
              matchId: room.matchId,
              round: room.currentRound,
              payload: { from: gameState, to: toGameOver },
            },
            now,
          ),
          createEvent(
            {
              type: DomainEventType.GAME_ENDED,
              roomId: room.id,
              matchId: room.matchId,
              round: room.currentRound,
              payload: { winner: winCheck.winner },
            },
            now,
          ),
        );
        finalGameState = toGameOver;
      } else {
        const toNight = this.stateMachine.assertTransition(gameState, GameState.NIGHT);
        nextRound = room.currentRound + 1;
        endgameEvents.push(
          createEvent(
            {
              type: DomainEventType.PHASE_CHANGED,
              roomId: room.id,
              matchId: room.matchId,
              round: nextRound,
              payload: { from: gameState, to: toNight },
            },
            now,
          ),
        );
        finalGameState = toNight;
      }

      const updated: RoomState = {
        ...roomAfterDeaths,
        gameState: finalGameState,
        currentRound: nextRound,
        updatedAt: now,
      };

      return {
        room: updated,
        events: [...deathEvents, executionEvent, ...phaseEvents, ...endgameEvents],
      };
    });

    const committedEvents = this.stampCommitVersion(events, room.version);
    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, committedEvents);
    }
    await this.eventBus.publishAll(committedEvents);

    return { room, executedTelegramId: params.executedTelegramId, deaths: capturedDeaths };
  }

  /**
   * Convenience wrapper combining prepareExecutionResolution + a synchronous
   * Hunter-decision callback + finalizeExecutionResolution, for callers that
   * already know every Hunter's decision synchronously (unit tests, or
   * scenarios with no Hunter role in play). Real Telegram flows should call
   * prepareExecutionResolution, await real prompts, then call
   * finalizeExecutionResolution directly.
   */
  async resolveExecution(params: {
    roomId: string;
    getHunterDecision: (
      hunterTelegramId: string,
    ) => { targetTelegramId: string | null } | null;
  }): Promise<{
    room: RoomState;
    executedTelegramId: string | null;
    deaths: Array<{ telegramId: string; cause: string }>;
  }> {
    const prepared = await this.prepareExecutionResolution(params.roomId);
    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of prepared.pendingHunterTelegramIds) {
      hunterDecisions[hunterId] = params.getHunterDecision(hunterId);
    }
    return this.finalizeExecutionResolution({
      roomId: params.roomId,
      roomVersion: prepared.roomVersion,
      executedTelegramId: prepared.executedTelegramId,
      voteCounts: prepared.voteCounts,
      depth0Deaths: prepared.depth0Deaths,
      hunterDecisions,
    });
  }
}
