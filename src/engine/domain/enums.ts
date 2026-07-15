/**
 * Core enumerations shared across the entire Game Engine.
 *
 * Design note: every "magic string" used to represent game concepts lives here.
 * Adding a new state/team/role id starts by extending these enums, never by
 * sprinkling new literal strings through the codebase (satisfies SRS requirement
 * of "no hard-coded values" and eases the Phase 2/3 role expansion).
 */

/** Main game state machine states (SRS section 5). */
export enum GameState {
  WAITING = 'WAITING',
  STARTING = 'STARTING',
  FIRST_NIGHT = 'FIRST_NIGHT',
  NIGHT = 'NIGHT',
  DAY = 'DAY',
  DISCUSSION = 'DISCUSSION',
  VOTING = 'VOTING',
  EXECUTION = 'EXECUTION',
  CHECK_WIN = 'CHECK_WIN',
  GAME_OVER = 'GAME_OVER',
}

/** Faction / team a role belongs to. Extensible for Phase 2+ (e.g. neutral teams). */
export enum Team {
  VILLAGE = 'VILLAGE',
  WEREWOLF = 'WEREWOLF',
  // Phase 2+: NEUTRAL, LOVERS, etc. can be appended without breaking existing code.
}

/** Role identifiers implemented in Phase 1. Phase 2 roles are added here later. */
export enum RoleId {
  WEREWOLF = 'WEREWOLF',
  VILLAGER = 'VILLAGER',
  SEER = 'SEER',
  BODYGUARD = 'BODYGUARD',
  HUNTER = 'HUNTER',
  WITCH = 'WITCH',
}

/** Cause of a player's death — used for Hunter trigger rules and logging. */
export enum DeathCause {
  WEREWOLF_KILL = 'WEREWOLF_KILL',
  VOTE_EXECUTION = 'VOTE_EXECUTION',
  WITCH_POISON = 'WITCH_POISON',
  HUNTER_SHOT = 'HUNTER_SHOT',
  // Phase 2+: LOVER_HEARTBREAK, etc.
}

/** Room lifecycle status, orthogonal to GameState (a room can exist before a match starts). */
export enum RoomStatus {
  OPEN = 'OPEN', // accepting joins
  LOCKED = 'LOCKED', // game running, no more joins
  CLOSED = 'CLOSED', // room deleted / match finished and archived
}

/** Which side ultimately won a match. */
export enum WinnerTeam {
  VILLAGE = 'VILLAGE',
  WEREWOLF = 'WEREWOLF',
  NONE = 'NONE', // game aborted / no winner yet
}

/** Behavior when a player's timed action expires without input (Suggestion #10). */
export enum TimeoutBehavior {
  SKIP = 'SKIP',
  RANDOM = 'RANDOM',
}

/** Category of a night action, used to order and resolve effects deterministically. */
export enum NightActionType {
  WEREWOLF_VOTE_KILL = 'WEREWOLF_VOTE_KILL',
  BODYGUARD_PROTECT = 'BODYGUARD_PROTECT',
  SEER_INSPECT = 'SEER_INSPECT',
  WITCH_SAVE = 'WITCH_SAVE',
  WITCH_POISON = 'WITCH_POISON',
  HUNTER_SHOOT = 'HUNTER_SHOOT',
}

/** Domain event type identifiers (event-sourcing-friendly log schema — Suggestion #11). */
export enum DomainEventType {
  ROOM_CREATED = 'ROOM_CREATED',
  ROOM_CLOSED = 'ROOM_CLOSED',
  PLAYER_JOINED = 'PLAYER_JOINED',
  PLAYER_LEFT = 'PLAYER_LEFT',
  PLAYER_KICKED = 'PLAYER_KICKED',
  GAME_STARTED = 'GAME_STARTED',
  ROLES_ASSIGNED = 'ROLES_ASSIGNED',
  PHASE_CHANGED = 'PHASE_CHANGED',
  NIGHT_ACTION_SUBMITTED = 'NIGHT_ACTION_SUBMITTED',
  NIGHT_ACTION_TIMEOUT = 'NIGHT_ACTION_TIMEOUT',
  NIGHT_RESOLVED = 'NIGHT_RESOLVED',
  PLAYER_DIED = 'PLAYER_DIED',
  VOTE_CAST = 'VOTE_CAST',
  VOTE_TIMEOUT = 'VOTE_TIMEOUT',
  EXECUTION_RESOLVED = 'EXECUTION_RESOLVED',
  WIN_CONDITION_MET = 'WIN_CONDITION_MET',
  GAME_ENDED = 'GAME_ENDED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  HOST_ACTION = 'HOST_ACTION',
}
