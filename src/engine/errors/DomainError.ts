/**
 * Base class for all engine-raised errors. Kept platform-agnostic — the
 * Telegram layer is responsible for translating these into user-facing
 * messages (in Vietnamese), so no display strings live here.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RoomNotFoundError extends DomainError {
  constructor(roomId: string) {
    super('ROOM_NOT_FOUND', `Room ${roomId} not found`);
  }
}

export class RoomFullError extends DomainError {
  constructor(roomId: string, maxPlayers: number) {
    super('ROOM_FULL', `Room ${roomId} already has max ${maxPlayers} players`);
  }
}

export class RoomLockedError extends DomainError {
  constructor(roomId: string) {
    super('ROOM_LOCKED', `Room ${roomId} is locked; cannot join`);
  }
}

export class PlayerAlreadyInRoomError extends DomainError {
  constructor(telegramId: string) {
    super('PLAYER_ALREADY_IN_ROOM', `Player ${telegramId} already joined`);
  }
}

export class PlayerNotInRoomError extends DomainError {
  constructor(telegramId: string) {
    super('PLAYER_NOT_IN_ROOM', `Player ${telegramId} is not in this room`);
  }
}

export class NotEnoughPlayersError extends DomainError {
  constructor(current: number, min: number) {
    super(
      'NOT_ENOUGH_PLAYERS',
      `Cannot start: ${current} players, minimum is ${min}`,
    );
  }
}

export class TooManyPlayersForRolesError extends DomainError {
  constructor(current: number, max: number) {
    super(
      'TOO_MANY_PLAYERS',
      `Cannot start: ${current} players exceeds maximum ${max}`,
    );
  }
}

export class NotHostError extends DomainError {
  constructor(telegramId: string) {
    super('NOT_HOST', `Player ${telegramId} is not the room host`);
  }
}

/** Anti-cheat: acting while dead (SRS section 11). */
export class DeadPlayerActionError extends DomainError {
  constructor(telegramId: string) {
    super('DEAD_PLAYER_ACTION', `Dead player ${telegramId} cannot act`);
  }
}

/** Anti-cheat: acting outside the phase that allows this action (SRS section 11). */
export class InvalidPhaseActionError extends DomainError {
  constructor(action: string, currentState: string) {
    super(
      'INVALID_PHASE_ACTION',
      `Action ${action} not allowed during ${currentState}`,
    );
  }
}

/** Anti-cheat: targeting an invalid target (dead, self when disallowed, etc). */
export class InvalidTargetError extends DomainError {
  constructor(reason: string) {
    super('INVALID_TARGET', `Invalid target: ${reason}`);
  }
}

export class WrongRoleForActionError extends DomainError {
  constructor(telegramId: string, requiredRole: string) {
    super(
      'WRONG_ROLE_FOR_ACTION',
      `Player ${telegramId} does not have role ${requiredRole}`,
    );
  }
}

export class NoPotionLeftError extends DomainError {
  constructor(potionType: string) {
    super('NO_POTION_LEFT', `Witch has no ${potionType} potion left`);
  }
}

/** Optimistic-locking conflict (Suggestion #1). */
export class ConcurrentModificationError extends DomainError {
  constructor(roomId: string) {
    super(
      'CONCURRENT_MODIFICATION',
      `Room ${roomId} was modified concurrently; retry`,
    );
  }
}

/** Duplicate action submission detected via idempotency key (Suggestion #2). */
export class DuplicateActionError extends DomainError {
  constructor(actionId: string) {
    super('DUPLICATE_ACTION', `Action ${actionId} was already processed`);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('INVALID_STATE_TRANSITION', `Cannot transition from ${from} to ${to}`);
  }
}

/** Confirmed UX rule: a player must DM the bot (/start) before they can join
 * a room, since Telegram forbids bots from proactively messaging users who
 * have never initiated a private chat with them. */
export class DmNotReachableError extends DomainError {
  constructor(telegramId: string) {
    super('DM_NOT_REACHABLE', `Player ${telegramId} has not started a DM with the bot yet`);
  }
}
