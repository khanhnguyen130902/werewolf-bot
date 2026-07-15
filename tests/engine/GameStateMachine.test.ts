import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState } from '../../src/engine/domain/enums';
import { InvalidStateTransitionError } from '../../src/engine/errors/DomainError';

describe('GameStateMachine', () => {
  const sm = new GameStateMachine();

  it('allows the full documented happy path sequence', () => {
    const sequence = [
      GameState.WAITING,
      GameState.STARTING,
      GameState.FIRST_NIGHT,
      GameState.DAY,
      GameState.DISCUSSION,
      GameState.VOTING,
      GameState.EXECUTION,
      GameState.CHECK_WIN,
      GameState.NIGHT,
      GameState.DAY,
      GameState.DISCUSSION,
      GameState.VOTING,
      GameState.EXECUTION,
      GameState.CHECK_WIN,
      GameState.GAME_OVER,
    ];
    for (let i = 0; i < sequence.length - 1; i++) {
      expect(sm.canTransition(sequence[i], sequence[i + 1])).toBe(true);
    }
  });

  it('allows CHECK_WIN -> GAME_OVER directly (win condition met)', () => {
    expect(sm.canTransition(GameState.CHECK_WIN, GameState.GAME_OVER)).toBe(true);
  });

  it('allows CHECK_WIN -> NIGHT (game continues)', () => {
    expect(sm.canTransition(GameState.CHECK_WIN, GameState.NIGHT)).toBe(true);
  });

  it('allows DAY -> CHECK_WIN as an early exit when night deaths already decide the match', () => {
    expect(sm.canTransition(GameState.DAY, GameState.CHECK_WIN)).toBe(true);
  });

  it('rejects illegal transitions (anti-cheat: cannot skip phases)', () => {
    expect(sm.canTransition(GameState.WAITING, GameState.NIGHT)).toBe(false);
    expect(sm.canTransition(GameState.DAY, GameState.VOTING)).toBe(false);
    expect(sm.canTransition(GameState.VOTING, GameState.DISCUSSION)).toBe(false);
  });

  it('assertTransition throws InvalidStateTransitionError for illegal moves', () => {
    expect(() => sm.assertTransition(GameState.WAITING, GameState.GAME_OVER)).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('assertTransition returns the target state for legal moves', () => {
    expect(sm.assertTransition(GameState.WAITING, GameState.STARTING)).toBe(
      GameState.STARTING,
    );
  });

  it('GAME_OVER is terminal', () => {
    expect(sm.isTerminal(GameState.GAME_OVER)).toBe(true);
    expect(sm.possibleNextStates(GameState.GAME_OVER)).toEqual([]);
  });

  it('non-terminal states have at least one possible next state', () => {
    expect(sm.isTerminal(GameState.WAITING)).toBe(false);
    expect(sm.possibleNextStates(GameState.WAITING).length).toBeGreaterThan(0);
  });
});
