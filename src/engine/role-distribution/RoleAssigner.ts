import { RoleId } from '../domain/enums';
import { RandomPort } from '../ports/RandomPort';
import { RoleDistributionPlan } from './RoleDistributionStrategy';
import { RoleRegistry } from '../roles/RoleRegistry';

export interface RoleAssignment {
  telegramId: string;
  roleId: RoleId;
}

/**
 * Turns a RoleDistributionPlan (how many of each role) into a concrete
 * assignment (which player gets which role), using injected randomness
 * (RandomPort) so assignment fairness is deterministically testable.
 *
 * Kept separate from RoleDistributionStrategy on purpose: distribution
 * strategy answers a game-design question ("how many wolves for N players"),
 * while this class answers a pure-mechanics question ("shuffle players and
 * hand out these role slots") — mixing the two would make it harder to unit
 * test fairness independently of the distribution formula.
 */
export class RoleAssigner {
  constructor(
    private readonly random: RandomPort,
    private readonly roleRegistry: RoleRegistry,
  ) {}

  assign(playerIds: string[], plan: RoleDistributionPlan): RoleAssignment[] {
    const totalPlanned = Object.values(plan).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );
    if (totalPlanned !== playerIds.length) {
      throw new Error(
        `Role distribution plan totals ${totalPlanned} but there are ${playerIds.length} players`,
      );
    }

    // Build a flat pool of role ids repeated per their planned count.
    const rolePool: RoleId[] = [];
    for (const [roleId, count] of Object.entries(plan) as [RoleId, number][]) {
      for (let i = 0; i < (count ?? 0); i++) {
        rolePool.push(roleId);
      }
    }

    // Validate every role in the plan is actually registered — fail fast
    // with a clear error instead of assigning an unusable role at runtime.
    for (const roleId of rolePool) {
      if (!this.roleRegistry.has(roleId)) {
        throw new Error(`Role ${roleId} is in the distribution plan but not registered`);
      }
    }

    const shuffledPlayers = this.random.shuffle(playerIds);
    const shuffledRoles = this.random.shuffle(rolePool);

    return shuffledPlayers.map((telegramId, index) => ({
      telegramId,
      roleId: shuffledRoles[index],
    }));
  }
}
