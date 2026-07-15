import { IRole, NightActionContext } from './IRole';
import { RoleId, Team } from '../domain/enums';

/**
 * Villager (Dân thường). No special skill — participates only in discussion
 * and voting during the day. Has no night action at all.
 */
export class VillagerRole implements IRole {
  readonly definition = {
    id: RoleId.VILLAGER,
    team: Team.VILLAGE,
    nameKey: 'role.villager',
    hasNightAction: false,
    nightActionType: null,
    reactsToOwnDeath: false,
  };

  validateNightAction(_context: NightActionContext): void {
    // Villager never submits a night action; NightResolver should never call
    // this, but we keep it a no-op (not a throw) to stay defensive rather
    // than crash the engine if it's ever invoked by mistake.
  }
}
