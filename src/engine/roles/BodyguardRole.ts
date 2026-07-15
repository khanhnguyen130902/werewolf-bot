import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Bodyguard (Bảo vệ). Each night protects one living player from the
 * werewolves' kill. Two configurable rules (SRS section 6):
 *   - bodyguardAllowSelfProtect: may target self.
 *   - bodyguardAllowConsecutiveProtect: may protect the same target two
 *     nights in a row. Enforcing the "consecutive" rule requires knowing the
 *     previous night's target, which is tracked by NightResolver/Room state
 *     (not visible to this validation-only class) — this class validates
 *     what it can from the immediate context (self-protect + alive check);
 *     the consecutive-protect check is enforced by the resolver, which has
 *     access to history.
 */
export class BodyguardRole implements IRole {
  readonly definition = {
    id: RoleId.BODYGUARD,
    team: Team.VILLAGE,
    nameKey: 'role.bodyguard',
    hasNightAction: true,
    nightActionType: NightActionType.BODYGUARD_PROTECT,
    reactsToOwnDeath: false,
  };

  validateNightAction(context: NightActionContext): void {
    if (context.targetTelegramId === null) {
      return;
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Target must be alive');
    }
    const allowSelfProtect = context.settings.bodyguardAllowSelfProtect === true;
    if (!allowSelfProtect && context.targetTelegramId === context.actorTelegramId) {
      throw new InvalidTargetError('Bodyguard self-protect is disabled by settings');
    }
  }
}
