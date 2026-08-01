import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Bodyguard (Bảo vệ). Each night protects one living player from the
 * werewolves' kill. Two configurable rules (SRS section 6):
 *   - bodyguardAllowSelfProtect: may target self.
 *   - consecutive protect rule: a Bodyguard may not protect the same target
 *     on two consecutive nights, including self-protect. The submission
 *     service enforces this rule using the previous night's saved target
 *     from room state; this class only validates the immediate target shape
 *     (self-protect availability + alive check).
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
