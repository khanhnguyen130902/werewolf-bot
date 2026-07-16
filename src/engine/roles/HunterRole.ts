import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Hunter (Thợ săn). Cho phép người chơi chọn trước một mục tiêu mỗi đêm.
 * Hành động này không có hiệu lực ngay lập tức; nó chỉ được kích hoạt nếu
 * Hunter chết bởi một nguyên nhân được cấu hình trong GameSettings.hunterTriggerCauses.
 * Revenge shot sử dụng cùng NightActionType.HUNTER_SHOOT để NightResolver và
 * DeathQueue xử lý đồng nhất với các hành động ban đêm khác.
 */
export class HunterRole implements IRole {
  readonly definition = {
    id: RoleId.HUNTER,
    team: Team.VILLAGE,
    nameKey: 'role.hunter',
    hasNightAction: true,
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
