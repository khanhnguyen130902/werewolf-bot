import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError } from '../errors/DomainError';

/**
 * Werewolf (Sói). Every night the werewolf faction collectively votes to
 * kill one target. May choose any living player or Skip. The actual "majority vote
 * among wolves" tallying is handled by NightResolver (Phase 3), since it
 * requires aggregating multiple wolves' submissions - this class only
 * validates a single wolf's individual vote submission.
 */
export class WerewolfRole implements IRole {
  readonly definition = {
    id: RoleId.WEREWOLF,
    team: Team.WEREWOLF,
    nameKey: 'role.werewolf',
    hasNightAction: true,
    nightActionType: NightActionType.WEREWOLF_VOTE_KILL,
    reactsToOwnDeath: false,
  };

  validateNightAction(context: NightActionContext): void {
    if (context.targetTelegramId === null) {
      // Abstaining is allowed to be represented as null and handled as a skip
      // by the resolver; validation only checks a *chosen* target's legality.
      return;
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Target must be alive');
    }
    // The faction vote deliberately exposes every living player, including
    // the acting wolf and their teammates. A unanimous vote is resolved by
    // NightResolver just like any other agreed target.
  }
}
