import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';
import { EventBus } from './events/EventBus';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { DomainEventType, GameState, DeathCause } from './domain/enums';
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
  ConcurrentModificationError,
  PlayerNotInRoomError,
} from './errors/DomainError';

const MAX_OPTIMISTIC_RETRY = 10;
const ACTION_ID_TTL_SECONDS = 60 * 30;

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
 *   - startVoting: DISCUSSION -> VOTING.
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

  /** DAY -> DISCUSSION. Pure phase transition; no player actions occur here. */
  async startDiscussion(roomId: string): Promise<RoomState> {
    return this.transitionOnly(roomId, GameState.DAY, GameState.DISCUSSION);
  }

  /** DISCUSSION -> VOTING. */
  async startVoting(roomId: string): Promise<RoomState> {
    return this.transitionOnly(roomId, GameState.DISCUSSION, GameState.VOTING);
  }

  private async transitionOnly(
    roomId: string,
    expectedFrom: GameState,
    to: GameState,
  ): Promise<RoomState> {
    const now = this.clock.now();
    const { room, events } = await this.withRetry(roomId, (room) => {
      if (room.gameState !== expectedFrom) {
        throw new InvalidPhaseActionError(`transition to ${to}`, room.gameState);
      }
      const target = this.stateMachine.assertTransition(room.gameState, to);
      const updated: RoomState = { ...room, gameState: target, updatedAt: now };
      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: { from: expectedFrom, to: target },
          },
          now,
        ),
      ];
      return { room: updated, events };
    });

    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, events);
    }
    await this.eventBus.publishAll(events);
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

    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, events);
    }
    await this.eventBus.publishAll(events);
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
    const submissions: VoteSubmission[] = alivePlayers.map((p) => ({
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

    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, events);
    }
    await this.eventBus.publishAll(events);

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
      executedTelegramId: prepared.executedTelegramId,
      voteCounts: prepared.voteCounts,
      depth0Deaths: prepared.depth0Deaths,
      hunterDecisions,
    });
  }
}
