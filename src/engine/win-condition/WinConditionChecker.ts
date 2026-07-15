import { RoomState } from '../domain/Room';
import { Team, WinnerTeam } from '../domain/enums';

export interface WinCheckResult {
  winner: WinnerTeam;
  aliveWerewolves: number;
  aliveVillagers: number;
}

/**
 * Evaluates the match win condition (SRS section 8):
 *   - Village wins when all werewolves are dead.
 *   - Werewolves win when their count is >= the village's count (i.e. they
 *     can no longer be out-voted), matching the classic Werewolf/Mafia rule.
 *
 * Implemented as a stateless pure function over a RoomState snapshot so it
 * can be called after every death-causing event (night resolution, day
 * execution) without any hidden coupling — this mirrors the SRS flow's
 * explicit "CHECK_WIN" state, which the GameStateMachine transitions into
 * after both NIGHT and EXECUTION.
 */
export class WinConditionChecker {
  check(room: RoomState): WinCheckResult {
    const alivePlayers = Object.values(room.players).filter((p) => p.alive);
    const aliveWerewolves = alivePlayers.filter((p) => p.team === Team.WEREWOLF).length;
    const aliveVillagers = alivePlayers.filter((p) => p.team === Team.VILLAGE).length;

    let winner: WinnerTeam = WinnerTeam.NONE;
    if (aliveWerewolves === 0) {
      winner = WinnerTeam.VILLAGE;
    } else if (aliveWerewolves >= aliveVillagers) {
      winner = WinnerTeam.WEREWOLF;
    }

    return { winner, aliveWerewolves, aliveVillagers };
  }
}
