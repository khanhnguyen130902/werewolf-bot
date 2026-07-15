import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Hunter (Thợ săn). Has no regular night action; instead, when killed by a
 * death-cause configured in GameSettings.hunterTriggerCauses (SRS: "Khi chết
 * bởi Sói/Vote/Độc (theo setting)"), fires one revenge shot before leaving
 * the game. The revenge-shot action itself is validated the same way as any
 * other targeted action (reuses NightActionType.HUNTER_SHOOT so NightResolver
 * can process it uniformly), but it is *triggered* by the death pipeline
 * rather than by the normal per-round night-action prompt.
 */
export class HunterRole implements IRole {
  readonly definition = {
    id: RoleId.HUNTER,
    team: Team.VILLAGE,
    nameKey: 'role.hunter',
    hasNightAction: false,
    nightActionType: NightActionType.HUNTER_SHOOT,
    reactsToOwnDeath: true,
  };

  validateNightAction(context: NightActionContext): void {
    if (context.targetTelegramId === null) {
      return; // Hunter may decline to shoot
    }
    if (context.targetTelegramId === context.actorTelegramId) {
      throw new InvalidTargetError('Hunter cannot shoot themselves');
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Target must be alive');
    }
  }
}
