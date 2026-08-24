import { GameState } from '../engine/domain/enums';

/**
 * Message deletion for muted/dead players is only valid while a room is
 * actively running. Redis markers can outlive a room when Telegram rejects an
 * unmute request, so GAME_OVER and a missing room must never hide later group
 * messages.
 */
export function shouldEnforceMutedMessageDeletion(
  room: { gameState: GameState } | null,
): boolean {
  return room !== null && room.gameState !== GameState.GAME_OVER;
}
