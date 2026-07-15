import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Seer (Tiên tri). Each night inspects one living player. Result defaults to
 * revealing only their Team (Village/Werewolf); GameSettings.seerRevealsExactRole
 * can switch this to reveal the exact Role instead (SRS section 6). The
 * actual result computation happens in NightResolver since it needs to read
 * the target's assigned role — this class only validates the target choice.
 *
 * Business rule (confirmed with product owner): if the Seer dies the same
 * night (e.g. killed by werewolves), they still receive their private
 * inspection result before being removed — this is enforced by NightResolver's
 * processing order (Seer action resolves and notifies BEFORE the death queue
 * is applied at the end of the night), not by this class.
 */
export class SeerRole implements IRole {
  readonly definition = {
    id: RoleId.SEER,
    team: Team.VILLAGE,
    nameKey: 'role.seer',
    hasNightAction: true,
    nightActionType: NightActionType.SEER_INSPECT,
    reactsToOwnDeath: false,
  };

  validateNightAction(context: NightActionContext): void {
    if (context.targetTelegramId === null) {
      return; // Seer may choose to skip (timeout -> handled by resolver policy)
    }
    if (context.targetTelegramId === context.actorTelegramId) {
      throw new InvalidTargetError('Seer cannot inspect themselves');
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Target must be alive');
    }
  }
}
