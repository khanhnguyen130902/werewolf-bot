import { DomainEventType } from '../domain/enums';

/**
 * Canonical, serializable domain event shape. Every state-changing operation
 * in the engine emits one or more of these. They serve THREE purposes at once:
 *   1. Audit log (SRS section 12 — "Lưu toàn bộ sự kiện").
 *   2. Decoupling engine from Telegram: the bot subscribes to events to render
 *      messages, instead of engine code calling Telegraf directly.
 *   3. Future Replay feature (SRS section 4/13, Suggestion #11): since the
 *      schema is stable and versioned from Phase 1, Phase 3 can replay a match
 *      by folding these events without any retroactive log migration.
 *
 * `payload` is intentionally typed as a discriminated union keyed by `type`
 * so consumers get compile-time safety when narrowing on event type.
 */
export interface BaseDomainEvent<T extends DomainEventType, P> {
  type: T;
  /** Schema version for this event type — bump if payload shape changes. */
  version: 1;
  roomId: string;
  matchId: string | null;
  round: number;
  timestamp: number;
  payload: P;
}

export type DomainEvent =
  | BaseDomainEvent<DomainEventType.ROOM_CREATED, { hostTelegramId: string }>
  | BaseDomainEvent<DomainEventType.ROOM_CLOSED, { reason: string }>
  | BaseDomainEvent<DomainEventType.PLAYER_JOINED, { telegramId: string; nickname: string }>
  | BaseDomainEvent<DomainEventType.PLAYER_LEFT, { telegramId: string }>
  | BaseDomainEvent<DomainEventType.PLAYER_KICKED, { telegramId: string; byHost: string }>
  | BaseDomainEvent<DomainEventType.GAME_STARTED, { playerCount: number }>
  | BaseDomainEvent<
      DomainEventType.ROLES_ASSIGNED,
      { assignments: Array<{ telegramId: string; role: string; team: string }> }
    >
  | BaseDomainEvent<DomainEventType.PHASE_CHANGED, { from: string; to: string }>
  | BaseDomainEvent<
      DomainEventType.NIGHT_ACTION_SUBMITTED,
      { telegramId: string; actionType: string; targetId: string | null; actionId: string }
    >
  | BaseDomainEvent<
      DomainEventType.NIGHT_ACTION_TIMEOUT,
      { telegramId: string; actionType: string; resolvedBehavior: string }
    >
  | BaseDomainEvent<DomainEventType.NIGHT_RESOLVED, { deaths: string[] }>
  | BaseDomainEvent<
      DomainEventType.PLAYER_DIED,
      { telegramId: string; cause: string; role: string }
    >
  | BaseDomainEvent<
      DomainEventType.VOTE_CAST,
      { telegramId: string; targetId: string | null }
    >
  | BaseDomainEvent<DomainEventType.VOTE_TIMEOUT, { telegramId: string }>
  | BaseDomainEvent<
      DomainEventType.EXECUTION_RESOLVED,
      { executedTelegramId: string | null; voteCounts: Record<string, number> }
    >
  | BaseDomainEvent<
      DomainEventType.WIN_CONDITION_MET,
      { winner: string; aliveWerewolves: number; aliveVillagers: number }
    >
  | BaseDomainEvent<DomainEventType.GAME_ENDED, { winner: string }>
  | BaseDomainEvent<DomainEventType.SYSTEM_ERROR, { code: string; message: string }>
  | BaseDomainEvent<DomainEventType.HOST_ACTION, { action: string; byHost: string; detail: string }>;

/** Helper to construct a well-formed event with timestamp auto-filled. */
export function createEvent<T extends DomainEvent>(
  partial: Omit<T, 'timestamp' | 'version'>,
  now: number,
): T {
  return {
    ...partial,
    version: 1,
    timestamp: now,
  } as T;
}
