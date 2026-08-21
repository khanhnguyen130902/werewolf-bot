import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Silent Mage: selects one living player to silence for the next discussion
 * cycle. Re-targeting on consecutive nights is explicitly allowed.
 */
export class SilentMageRole implements IRole {
  readonly definition = {
    id: RoleId.SILENT_MAGE,
    team: Team.VILLAGE,
    nameKey: 'role.silentMage',
    hasNightAction: true,
    nightActionType: NightActionType.SILENT_MAGE_SILENCE,
    reactsToOwnDeath: false,
  };

  validateNightAction(context: NightActionContext): void {
    if (context.targetTelegramId === null) return;
    if (context.targetTelegramId === context.actorTelegramId) {
      throw new InvalidTargetError('Silent Mage cannot silence themselves');
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Target must be alive');
    }
  }
}
