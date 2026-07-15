import { GameState } from '../domain/enums';
import { InvalidStateTransitionError } from '../errors/DomainError';

/**
 * Explicit transition table encoding the state machine from SRS section 5:
 *
 *   WAITING -> STARTING -> FIRST_NIGHT -> NIGHT -> DAY -> DISCUSSION
 *   -> VOTING -> EXECUTION -> CHECK_WIN -> NIGHT ... -> GAME_OVER
 *
 * DAY -> CHECK_WIN is an additional, deliberate early-exit edge: if the
 * night's deaths already decide the match (e.g. werewolves reach parity),
 * there is no point running DISCUSSION/VOTING/EXECUTION on a foregone
 * conclusion. This lets NightActionService.resolveNight check the win
 * condition immediately after applying night deaths and, when the match is
 * over, skip straight to CHECK_WIN -> GAME_OVER instead of forcing an empty
 * day cycle. The "full" path through DISCUSSION/VOTING/EXECUTION remains the
 * normal case whenever the match is NOT yet decided by the night's results.
 *
 * Design rationale: representing allowed transitions as a lookup table
 * (rather than scattering `if (state === X)` checks across the codebase)
 * gives us ONE place to audit "can the game legally move from A to B?" — this
 * directly supports the anti-cheat requirement ("khóa thao tác ngoài phase")
 * because any code path attempting an illegal transition fails loudly with
 * InvalidStateTransitionError instead of silently corrupting game state.
 *
 * CHECK_WIN is a branch point: it can lead to GAME_OVER (win condition met)
 * or back to NIGHT (game continues, per the SRS diagram's "NIGHT ..." loop).
 */
const TRANSITIONS: Record<GameState, GameState[]> = {
  [GameState.WAITING]: [GameState.STARTING],
  [GameState.STARTING]: [GameState.FIRST_NIGHT, GameState.WAITING], // WAITING = abort/reset path
  [GameState.FIRST_NIGHT]: [GameState.DAY],
  [GameState.NIGHT]: [GameState.DAY],
  [GameState.DAY]: [GameState.DISCUSSION, GameState.CHECK_WIN], // CHECK_WIN = early exit, see above
  [GameState.DISCUSSION]: [GameState.VOTING],
  [GameState.VOTING]: [GameState.EXECUTION],
  [GameState.EXECUTION]: [GameState.CHECK_WIN],
  [GameState.CHECK_WIN]: [GameState.NIGHT, GameState.GAME_OVER],
  [GameState.GAME_OVER]: [], // terminal state
};

export class GameStateMachine {
  /**
   * Returns true if transitioning from `from` to `to` is a legal single step
   * per the table above.
   */
  canTransition(from: GameState, to: GameState): boolean {
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Validates and returns the target state, or throws
   * InvalidStateTransitionError. Centralizing the throw here means every
   * call site (GameService, NightResolver, VotingResolver) gets identical,
   * predictable error behavior.
   */
  assertTransition(from: GameState, to: GameState): GameState {
    if (!this.canTransition(from, to)) {
      throw new InvalidStateTransitionError(from, to);
    }
    return to;
  }

  /** All states reachable directly from `from` — useful for UI/debug tooling. */
  possibleNextStates(from: GameState): GameState[] {
    return [...(TRANSITIONS[from] ?? [])];
  }

  isTerminal(state: GameState): boolean {
    return TRANSITIONS[state].length === 0;
  }
}
