import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';
import { RandomPort } from './ports/RandomPort';
import { EventBus } from './events/EventBus';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { DomainEventType, GameState, NightPhase, RoleId, NightActionType } from './domain/enums';
import { RoomState } from './domain/Room';
import { RoleRegistry } from './roles/RoleRegistry';
import { WitchRole } from './roles/WitchRole';
import { NightActionContext } from './roles/IRole';
import { NightResolver } from './night/NightResolver';
import { WinConditionChecker } from './win-condition/WinConditionChecker';
import { GameStateMachine } from './state-machine/GameStateMachine';
import {
  RoomNotFoundError,
  DeadPlayerActionError,
  InvalidPhaseActionError,
  WrongRoleForActionError,
  DuplicateActionError,
  ConcurrentModificationError,
  PlayerNotInRoomError,
} from './errors/DomainError';

const MAX_OPTIMISTIC_RETRY = 10;
/** How long a processed actionId is remembered for dedup purposes, bounding
 * memory: comfortably longer than any single night's timer could run. */
const ACTION_ID_TTL_SECONDS = 60 * 30;

/** Maps a NightActionType to the RoleId that is allowed to submit it, for
 * the anti-cheat "wrong role" check. Witch's two action types both map to
 * WITCH; Hunter's revenge shot maps to HUNTER but is only ever accepted
 * while HUNTER is in a "pending revenge" micro-state (checked separately —
 * see submitHunterRevengeShot). */
const ACTION_TYPE_TO_ROLE: Partial<Record<NightActionType, RoleId>> = {
  [NightActionType.WEREWOLF_VOTE_KILL]: RoleId.WEREWOLF,
  [NightActionType.BODYGUARD_PROTECT]: RoleId.BODYGUARD,
  [NightActionType.SEER_INSPECT]: RoleId.SEER,
  [NightActionType.WITCH_SAVE]: RoleId.WITCH,
  [NightActionType.WITCH_POISON]: RoleId.WITCH,
  [NightActionType.HUNTER_SHOOT]: RoleId.HUNTER,
};

/**
 * Application service handling the night-action submission and resolution
 * lifecycle. Split from GameService (which owns match start/lifecycle) to
 * keep each service focused: GameService answers "start/end the match",
 * NightActionService answers "collect and resolve one night's actions".
 *
 * Anti-cheat enforcement (SRS section 11) happens entirely in
 * `submitNightAction` before anything is persisted:
 *   1. Player must exist in the room (PlayerNotInRoomError).
 *   2. Player must be alive (DeadPlayerActionError).
 *   3. Room must be in NIGHT or FIRST_NIGHT (InvalidPhaseActionError).
 *   4. Player's assigned role must match the action type's required role
 *      (WrongRoleForActionError) — prevents a Villager from spoofing a
 *      Werewolf's kill action even if they somehow know the action shape.
 *   5. Role-specific target validation (IRole.validateNightAction /
 *      Witch's validateSaveAction/validatePoisonAction) — enforces alive
 *      targets, self-target rules, potion availability, etc.
 *   6. Idempotency check (Suggestion #2) via StoragePort.recordActionIdIfNew
 *      — a retried/duplicated button press is rejected before being counted.
 */
export class NightActionService {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
    private readonly random: RandomPort,
    private readonly eventBus: EventBus,
    private readonly roleRegistry: RoleRegistry,
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

  /**
   * Submits a single night action from a player. Validates anti-cheat rules,
   * validates the target via the role's own validation logic, checks
   * idempotency, and appends to `room.pendingNightActions` for later
   * resolution by `resolveNight`.
   */
  async submitNightAction(params: {
    roomId: string;
    actionId: string;
    actorTelegramId: string;
    actionType: NightActionType;
    targetTelegramId: string | null;
  }): Promise<RoomState> {
    const now = this.clock.now();

    // Idempotency check happens outside the optimistic-retry mutate closure
    // because it has its own dedicated storage call and must not be
    // re-executed on every retry attempt (that would let a legitimate retry
    // of the SAME logical write look like a duplicate). We check-and-record
    // once, up front.
    const isNew = await this.storage.recordActionIdIfNew(
      params.roomId,
      params.actionId,
      ACTION_ID_TTL_SECONDS,
    );
    if (!isNew) {
      throw new DuplicateActionError(params.actionId);
    }

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      const player = room.players[params.actorTelegramId];
      if (!player) {
        throw new PlayerNotInRoomError(params.actorTelegramId);
      }
      if (!player.alive) {
        throw new DeadPlayerActionError(params.actorTelegramId);
      }
      if (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT) {
        throw new InvalidPhaseActionError(params.actionType, room.gameState);
      }

      const nightPhase = room.nightPhase ?? NightPhase.ACTIONS;
      const isWitchAction =
        params.actionType === NightActionType.WITCH_SAVE ||
        params.actionType === NightActionType.WITCH_POISON;
      if ((nightPhase === NightPhase.WITCH) !== isWitchAction) {
        throw new InvalidPhaseActionError(params.actionType, room.gameState);
      }

      const requiredRole = ACTION_TYPE_TO_ROLE[params.actionType];
      if (requiredRole && player.role !== requiredRole) {
        throw new WrongRoleForActionError(params.actorTelegramId, requiredRole);
      }

      const alivePlayerIds = Object.values(room.players)
        .filter((p) => p.alive)
        .map((p) => p.telegramId);
      const rolesByPlayer: Record<string, RoleId> = {};
      for (const p of Object.values(room.players)) {
        if (p.role) rolesByPlayer[p.telegramId] = p.role;
      }

      const context: NightActionContext = {
        actorTelegramId: params.actorTelegramId,
        targetTelegramId: params.targetTelegramId,
        alivePlayerIds,
        rolesByPlayer,
        round: room.currentRound,
        settings: room.settings as unknown as Record<string, unknown>,
      };

      // Role-specific validation. Witch requires special-cased calls since
      // her two potion actions have distinct signatures (see WitchRole doc).
      if (params.actionType === NightActionType.WITCH_SAVE) {
        const witchRole = this.roleRegistry.get(RoleId.WITCH) as WitchRole;
        witchRole.validateSaveAction(context, room.witchPotions ? !room.witchPotions.saveUsed : false);
      } else if (params.actionType === NightActionType.WITCH_POISON) {
        const witchRole = this.roleRegistry.get(RoleId.WITCH) as WitchRole;
        const alreadyUsedSaveThisNight = room.pendingNightActions.some(
          (a) =>
            a.actorTelegramId === params.actorTelegramId &&
            a.actionType === NightActionType.WITCH_SAVE,
        );
        witchRole.validatePoisonAction(
          context,
          room.witchPotions ? !room.witchPotions.poisonUsed : false,
          room.settings.witchAllowDualPotion,
          alreadyUsedSaveThisNight,
        );
      } else {
        const role = this.roleRegistry.get(player.role as RoleId);
        role.validateNightAction(context);
      }

      // One submission per actor per round for each action type. A Witch may
      // still submit both save and poison in the same night when settings
      // allow dual potion, because those are distinct actions.
      const existingSameRoundIndex = room.pendingNightActions.findIndex(
        (a) =>
          a.actorTelegramId === params.actorTelegramId &&
          a.actionType === params.actionType &&
          a.round === room.currentRound,
      );
      if (existingSameRoundIndex >= 0) {
        throw new DuplicateActionError(params.actionId);
      }

      const pendingNightActions = [
        ...room.pendingNightActions,
        {
          actionId: params.actionId,
          actorTelegramId: params.actorTelegramId,
          actionType: params.actionType,
          targetTelegramId: params.targetTelegramId,
          round: room.currentRound,
        },
      ];

      const updated: RoomState = {
        ...room,
        pendingNightActions,
        updatedAt: now,
      };

      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.NIGHT_ACTION_SUBMITTED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: {
              telegramId: params.actorTelegramId,
              actionType: params.actionType,
              targetId: params.targetTelegramId,
              actionId: params.actionId,
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
  /**
   * Step 1 of the split night-resolution flow (see NightResolver/DeathQueue
   * doc for the full rationale): runs the night-action pipeline and
   * identifies which Hunters (if any) died and need a revenge-shot prompt,
   * WITHOUT yet mutating any room/player state or transitioning the state
   * machine. The Telegram layer calls this first, then awaits a real prompt
   * for each id in `pendingHunterTelegramIds` (or immediately supplies `null`
   * if no Hunters are pending), then calls `finalizeNightResolution` with
   * the collected decisions.
   *
   * `pendingNightActions` is intentionally NOT cleared here — it's cleared
   * only in `finalizeNightResolution`, so if the process crashes between
   * these two calls, the already-submitted actions are not lost and the
   * night can be re-prepared from the same submissions after restart.
   */
  /** Moves a live night from the parallel role actions to the Witch-only
   * sub-phase. The optimistic write makes concurrent callbacks idempotent. */
  async beginWitchPhase(roomId: string): Promise<RoomState> {
    const now = this.clock.now();
    const { room } = await this.withRetry(roomId, (room) => {
      if (room.gameState !== GameState.NIGHT && room.gameState !== GameState.FIRST_NIGHT) {
        throw new InvalidPhaseActionError('WITCH_PHASE', room.gameState);
      }
      if (room.nightPhase === NightPhase.WITCH) return { room, events: [] };
      return { room: { ...room, nightPhase: NightPhase.WITCH, updatedAt: now }, events: [] };
    });
    return room;
  }

  async prepareNightResolution(roomId: string): Promise<{
    room: RoomState;
    stepOneResult: ReturnType<NightResolver['resolveWithoutHunterRevenge']>;
  }> {
    const room = await this.storage.getRoom(roomId);
    if (!room) {
      throw new RoomNotFoundError(roomId);
    }
    const resolver = new NightResolver(this.random);
    const submissions = room.pendingNightActions.map((a) => ({
      actionId: a.actionId,
      actorTelegramId: a.actorTelegramId,
      actionType: a.actionType as NightActionType,
      targetTelegramId: a.targetTelegramId,
      round: a.round,
    }));
    const stepOneResult = resolver.resolveWithoutHunterRevenge({ room, submissions });
    return { room, stepOneResult };
  }

  /**
   * Step 2: applies the Hunter revenge decisions collected by the caller
   * (after awaiting real Telegram prompts, or supplying `null` for any
   * Hunter who declined/timed out), finalizes all death/room-state changes,
   * checks the win condition, and transitions the state machine
   * (FIRST_NIGHT/NIGHT -> DAY -> CHECK_WIN -> GAME_OVER, or -> DAY only if
   * the match continues).
   */
  async finalizeNightResolution(params: {
    roomId: string;
    stepOneResult: ReturnType<NightResolver['resolveWithoutHunterRevenge']>;
    hunterDecisions: Record<string, { targetTelegramId: string | null } | null>;
  }): Promise<{
    room: RoomState;
    deaths: Array<{ telegramId: string; cause: string }>;
    seerResults: Array<{
      seerTelegramId: string;
      targetTelegramId: string;
      revealedTeam: string;
      revealedRole: string | null;
    }>;
  }> {
    const now = this.clock.now();
    const resolver = new NightResolver(this.random);
    const winChecker = new WinConditionChecker();

    let capturedDeaths: Array<{ telegramId: string; cause: string }> = [];
    let capturedSeerResults: NightActionContext[] = [];

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      let updatedPlayers = { ...room.players };
      // Hunter's Phase-1 selection is persisted before resolving deaths, so
      // DeathQueue can use it immediately if the Hunter dies tonight.
      for (const action of room.pendingNightActions) {
        if (
          action.actionType === NightActionType.HUNTER_SHOOT &&
          action.round === room.currentRound &&
          updatedPlayers[action.actorTelegramId]
        ) {
          updatedPlayers[action.actorTelegramId] = {
            ...updatedPlayers[action.actorTelegramId],
            hunterRevengeTarget: action.targetTelegramId,
          };
        }
      }
      for (const [hunterId, decision] of Object.entries(params.hunterDecisions)) {
        const hunterPlayer = updatedPlayers[hunterId];
        if (!hunterPlayer || !decision || decision.targetTelegramId === null) continue;
        updatedPlayers[hunterId] = {
          ...hunterPlayer,
          hunterRevengeTarget: decision.targetTelegramId,
        };
      }

      const roomWithPersistedHunterTargets = {
        ...room,
        players: updatedPlayers,
      };

      const { room: afterNight, result } = resolver.applyHunterRevengeAndFinalize({
        room: roomWithPersistedHunterTargets,
        stepOneResult: params.stepOneResult,
        hunterDecisions: params.hunterDecisions,
      });

      capturedDeaths = result.deaths;
      capturedSeerResults = result.seerResults as unknown as NightActionContext[];

      const stateEvents: DomainEvent[] = [];
      const deathEvents: DomainEvent[] = result.deaths.map((d) =>
        createEvent(
          {
            type: DomainEventType.PLAYER_DIED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: {
              telegramId: d.telegramId,
              cause: d.cause,
              role: afterNight.players[d.telegramId]?.role ?? 'UNKNOWN',
            },
          },
          now,
        ),
      );

      const nightResolvedEvent = createEvent(
        {
          type: DomainEventType.NIGHT_RESOLVED,
          roomId: room.id,
          matchId: room.matchId,
          round: room.currentRound,
          payload: { deaths: result.deaths.map((d) => d.telegramId) },
        },
        now,
      );

      const winCheck = winChecker.check(afterNight);

      let gameState: GameState = room.gameState;
      const toDay = this.stateMachine.assertTransition(gameState, GameState.DAY);
      stateEvents.push(
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId: room.matchId,
            round: room.currentRound,
            payload: { from: gameState, to: toDay },
          },
          now,
        ),
      );
      gameState = toDay;

      let finalGameState = gameState;
      const extraEvents: DomainEvent[] = [];

      if (winCheck.winner !== 'NONE') {
        const toCheckWin = this.stateMachine.assertTransition(gameState, GameState.CHECK_WIN);
        extraEvents.push(
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
        const toGameOver = this.stateMachine.assertTransition(toCheckWin, GameState.GAME_OVER);
        extraEvents.push(
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
              payload: { from: toCheckWin, to: toGameOver },
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
      }

      const updated: RoomState = {
        ...afterNight,
        gameState: finalGameState,
        pendingNightActions: [],
        nightPhase: NightPhase.ACTIONS,
        updatedAt: now,
      };

      return {
        room: updated,
        events: [...deathEvents, nightResolvedEvent, ...stateEvents, ...extraEvents],
      };
    });

    if (room.matchId) {
      await this.storage.appendEvents(room.matchId, events);
    }
    await this.eventBus.publishAll(events);

    return {
      room,
      deaths: capturedDeaths,
      seerResults: capturedSeerResults as unknown as Array<{
        seerTelegramId: string;
        targetTelegramId: string;
        revealedTeam: string;
        revealedRole: string | null;
      }>,
    };
  }

  /**
   * Convenience wrapper combining prepareNightResolution + a synchronous
   * Hunter-decision callback + finalizeNightResolution, for callers that
   * already know every Hunter's decision synchronously (unit tests, or
   * scenarios with no Hunter role in play at all). Real Telegram flows
   * should call prepareNightResolution, await real prompts, then call
   * finalizeNightResolution directly -- see those methods' docs.
   */
  async resolveNight(params: {
    roomId: string;
    getHunterDecision: (
      hunterTelegramId: string,
    ) => { targetTelegramId: string | null } | null;
  }): Promise<{
    room: RoomState;
    deaths: Array<{ telegramId: string; cause: string }>;
    seerResults: Array<{
      seerTelegramId: string;
      targetTelegramId: string;
      revealedTeam: string;
      revealedRole: string | null;
    }>;
  }> {
    const { stepOneResult } = await this.prepareNightResolution(params.roomId);
    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of stepOneResult.pendingHunterTelegramIds) {
      hunterDecisions[hunterId] = params.getHunterDecision(hunterId);
    }
    return this.finalizeNightResolution({
      roomId: params.roomId,
      stepOneResult,
      hunterDecisions,
    });
  }
}
