import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';
import { RandomPort } from './ports/RandomPort';
import { EventBus } from './events/EventBus';
import { createEvent, DomainEvent } from './events/DomainEvent';
import { DomainEventType, GameState, RoomStatus, RoleId } from './domain/enums';
import { RoomState } from './domain/Room';
import { RoleRegistry } from './roles/RoleRegistry';
import { RoleDistributionStrategyRegistry } from './role-distribution/RoleDistributionStrategyRegistry';
import { RoleAssigner } from './role-distribution/RoleAssigner';
import { GameStateMachine } from './state-machine/GameStateMachine';
import {
  RoomNotFoundError,
  NotHostError,
  NotEnoughPlayersError,
  TooManyPlayersForRolesError,
  ConcurrentModificationError,
} from './errors/DomainError';

const MAX_OPTIMISTIC_RETRY = 10;

/**
 * Application service orchestrating match lifecycle operations that require
 * cross-cutting coordination between Room state, the Role system, and the
 * State Machine. Kept separate from RoomService (which only manages
 * room/player membership) to respect single-responsibility: RoomService
 * answers "who is in this room", GameService answers "what is happening in
 * the match currently running in this room".
 */
export class GameService {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
    private readonly random: RandomPort,
    private readonly eventBus: EventBus,
    private readonly roleRegistry: RoleRegistry,
    private readonly distributionRegistry: RoleDistributionStrategyRegistry,
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
   * Starts a match for the given room: validates player count, computes the
   * role distribution, randomly assigns roles, initializes match-scoped
   * state (matchId, witch potions), and transitions
   * WAITING -> STARTING -> FIRST_NIGHT.
   *
   * Two state-machine hops happen in a single call because STARTING is a
   * transient bookkeeping state with no player-facing waiting period (SRS's
   * diagram lists it, but no requirement says players wait *in* STARTING) —
   * modeling it as an instantaneous pass-through keeps the observable
   * behavior correct while still emitting a PHASE_CHANGED event for each hop,
   * so the audit log accurately reflects that both states were visited.
   */
  async startGame(params: {
    roomId: string;
    requestedByTelegramId: string;
  }): Promise<RoomState> {
    const now = this.clock.now();
    const matchId = `${params.roomId}-${now}`;

    const { room, events } = await this.withRetry(params.roomId, (room) => {
      if (room.hostTelegramId !== params.requestedByTelegramId) {
        throw new NotHostError(params.requestedByTelegramId);
      }

      const playerIds = Object.keys(room.players);
      if (playerIds.length < room.settings.minPlayers) {
        throw new NotEnoughPlayersError(playerIds.length, room.settings.minPlayers);
      }
      if (playerIds.length > room.settings.maxPlayers) {
        throw new TooManyPlayersForRolesError(playerIds.length, room.settings.maxPlayers);
      }

      const strategy = this.distributionRegistry.get(room.settings.roleDistributionStrategy);
      const enabledSpecialRoles = room.settings.enabledRoles as RoleId[];
      const plan = strategy.computeDistribution(playerIds.length, enabledSpecialRoles);

      const assigner = new RoleAssigner(this.random, this.roleRegistry);
      const assignments = assigner.assign(playerIds, plan);

      const updatedPlayers = { ...room.players };
      const assignmentEventPayload: Array<{
        telegramId: string;
        role: string;
        team: string;
      }> = [];

      for (const { telegramId, roleId } of assignments) {
        const roleDef = this.roleRegistry.get(roleId).definition;
        updatedPlayers[telegramId] = {
          ...updatedPlayers[telegramId],
          role: roleId,
          team: roleDef.team,
        };
        assignmentEventPayload.push({
          telegramId,
          role: roleId,
          team: roleDef.team,
        });
      }

      const hasWitch = assignments.some((a) => a.roleId === RoleId.WITCH);

      let gameState: GameState = room.gameState;
      const stateEvents: DomainEvent[] = [];

      const toStarting = this.stateMachine.assertTransition(
        gameState,
        GameState.STARTING,
      );
      stateEvents.push(
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId,
            round: 0,
            payload: { from: gameState, to: toStarting },
          },
          now,
        ),
      );
      gameState = toStarting;

      const toFirstNight = this.stateMachine.assertTransition(
        gameState,
        GameState.FIRST_NIGHT,
      );
      stateEvents.push(
        createEvent(
          {
            type: DomainEventType.PHASE_CHANGED,
            roomId: room.id,
            matchId,
            round: 0,
            payload: { from: gameState, to: toFirstNight },
          },
          now,
        ),
      );
      gameState = toFirstNight;

      const updated: RoomState = {
        ...room,
        status: RoomStatus.LOCKED,
        gameState,
        players: updatedPlayers,
        currentRound: 1,
        matchId,
        witchPotions: hasWitch ? { saveUsed: false, poisonUsed: false } : null,
        lastProtectedByBodyguard: {},
        pendingNightActions: [],
        updatedAt: now,
      };

      const events: DomainEvent[] = [
        createEvent(
          {
            type: DomainEventType.GAME_STARTED,
            roomId: room.id,
            matchId,
            round: 1,
            payload: { playerCount: playerIds.length },
          },
          now,
        ),
        createEvent(
          {
            type: DomainEventType.ROLES_ASSIGNED,
            roomId: room.id,
            matchId,
            round: 1,
            payload: { assignments: assignmentEventPayload },
          },
          now,
        ),
        ...stateEvents,
      ];

      return { room: updated, events };
    });

    await this.storage.appendEvents(matchId, events);
    await this.eventBus.publishAll(events);
    return room;
  }

  /** Returns the Team currently holding the majority-vote win, or null if the
   * match is not over. Exposed here for convenience; the authoritative
   * implementation lives in WinConditionChecker (Phase 3). */
  async getRoom(roomId: string): Promise<RoomState | null> {
    return this.storage.getRoom(roomId);
  }
}
