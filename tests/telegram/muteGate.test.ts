import { GameState } from '../../src/engine/domain/enums';
import { shouldEnforceMutedMessageDeletion } from '../../src/telegram/muteGate';

describe('shouldEnforceMutedMessageDeletion', () => {
  it('enforces deletion while a room is in an active game phase', () => {
    expect(shouldEnforceMutedMessageDeletion({ gameState: GameState.DISCUSSION })).toBe(true);
    expect(shouldEnforceMutedMessageDeletion({ gameState: GameState.VOTING })).toBe(true);
  });

  it('skips deletion after the game reaches GAME_OVER', () => {
    expect(shouldEnforceMutedMessageDeletion({ gameState: GameState.GAME_OVER })).toBe(false);
  });

  it('skips deletion when the room no longer exists', () => {
    expect(shouldEnforceMutedMessageDeletion(null)).toBe(false);
  });
});
