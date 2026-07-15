import { RoleId, Team } from './enums';

/**
 * Serializable snapshot of a Player, matching the fields defined in SRS section 9.
 * Kept as a plain interface (not a class) so it can be trivially (de)serialized
 * to/from Redis hashes/JSON without custom mapping code.
 */
export interface PlayerState {
  telegramId: string;
  nickname: string;
  role: RoleId | null;
  team: Team | null;
  alive: boolean;
  /** True if a Bodyguard protected this player during the current night. Reset every night. */
  protected: boolean;
  /** True if the Witch poisoned this player during the current night. Reset every night. */
  poisoned: boolean;
  /** Chosen vote target's telegramId during the current VOTING phase. Reset every day cycle. */
  voteTarget: string | null;
  /** Whether this player has already submitted a vote for the current round. */
  hasVotedThisRound: boolean;
  /** Whether this player is the room host (SRS: "Host quản lý phòng"). */
  isHost: boolean;
  /** Monotonic join order — used for deterministic tie-breaks and display order. */
  joinedAt: number;
  /** Cause of death, set once the player dies; null while alive. */
  deathCause: string | null;
  /** Round number in which the player died; null while alive. */
  diedOnRound: number | null;
}

/**
 * Factory + pure behavior functions for Player.
 *
 * Deliberately implemented as pure functions operating on the PlayerState
 * interface rather than a stateful class: this keeps the domain layer
 * trivially testable and serialization-safe (no hidden state, no `this`
 * binding issues when objects travel through Redis JSON round-trips).
 */
export class PlayerFactory {
  static create(params: {
    telegramId: string;
    nickname: string;
    isHost?: boolean;
    joinedAt: number;
  }): PlayerState {
    return {
      telegramId: params.telegramId,
      nickname: params.nickname,
      role: null,
      team: null,
      alive: true,
      protected: false,
      poisoned: false,
      voteTarget: null,
      hasVotedThisRound: false,
      isHost: params.isHost ?? false,
      joinedAt: params.joinedAt,
      deathCause: null,
      diedOnRound: null,
    };
  }
}

export function resetNightFlags(player: PlayerState): PlayerState {
  return {
    ...player,
    protected: false,
    poisoned: false,
  };
}

export function resetVote(player: PlayerState): PlayerState {
  return {
    ...player,
    voteTarget: null,
    hasVotedThisRound: false,
  };
}

export function killPlayer(
  player: PlayerState,
  cause: string,
  round: number,
): PlayerState {
  return {
    ...player,
    alive: false,
    deathCause: cause,
    diedOnRound: round,
  };
}
