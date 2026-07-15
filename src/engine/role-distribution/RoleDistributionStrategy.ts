import { RoleId } from '../domain/enums';
import { TooManyPlayersForRolesError, NotEnoughPlayersError } from '../errors/DomainError';

/**
 * A role-distribution plan: how many of each role to assign for a given
 * player count. `RoleDistributionStrategy` implementations compute this;
 * the actual random assignment-to-players happens in RoleAssigner (uses
 * RandomPort to shuffle), keeping "how many of each role" (a game-design
 * decision) separate from "who gets which" (a pure randomness concern).
 */
export type RoleDistributionPlan = Partial<Record<RoleId, number>>;

export interface RoleDistributionStrategy {
  readonly id: string;
  /**
   * @param playerCount total players in the room.
   * @param enabledSpecialRoles special roles (Seer/Bodyguard/Hunter/Witch)
   *   the host has opted into for this match, from GameSettings.enabledRoles.
   *   If a requested role can't fit, throws TooManyPlayersForRolesError.
   */
  computeDistribution(
    playerCount: number,
    enabledSpecialRoles: RoleId[],
  ): RoleDistributionPlan;
}

const SPECIAL_ROLES: RoleId[] = [
  RoleId.SEER,
  RoleId.BODYGUARD,
  RoleId.HUNTER,
  RoleId.WITCH,
];

/**
 * Default Phase 1 distribution strategy (business rule confirmed with
 * product owner):
 *   - Werewolf count = floor(playerCount / 4), minimum 1.
 *   - Special roles = exactly the ones the host enabled via
 *     `settings.enabledRoles`, provided there is room for them (each special
 *     role costs one non-werewolf slot). Unset special roles are simply
 *     omitted for this match rather than auto-filled — this matches the
 *     "host chooses which roles to use" decision, giving hosts control over
 *     game variety/difficulty instead of a rigid one-size-fits-all mapping.
 *   - Remaining slots (playerCount - wolves - enabled specials) become
 *     Villager.
 *
 * Validation: if enabledSpecialRoles requests more special roles than there
 * is room for (i.e. wolves + specials > playerCount), this throws
 * TooManyPlayersForRolesError with a clear message rather than silently
 * dropping a role — silent role-dropping would be a serious, hard-to-debug
 * game-design bug (a host could think Witch is in play when it silently
 * isn't).
 */
export class DefaultPhase1DistributionStrategy implements RoleDistributionStrategy {
  readonly id = 'default-phase1';

  computeDistribution(
    playerCount: number,
    enabledSpecialRoles: RoleId[],
  ): RoleDistributionPlan {
    if (playerCount < 1) {
      throw new NotEnoughPlayersError(playerCount, 1);
    }

    const werewolfCount =
      playerCount >= 5 ? Math.max(2, Math.floor(playerCount / 4)) : Math.max(1, Math.floor(playerCount / 4));
    const minimumVillagerCount = 1;

    if (playerCount === 1) {
      return {
        [RoleId.WEREWOLF]: 1,
      };
    }

    const requestedSpecials = enabledSpecialRoles.filter((r) =>
      SPECIAL_ROLES.includes(r),
    );
    // De-duplicate defensively in case caller passes duplicates.
    const uniqueSpecials = [...new Set(requestedSpecials)];

    const nonVillagerNonWolfCount = uniqueSpecials.length;
    const usedSlots = werewolfCount + nonVillagerNonWolfCount;

    if (usedSlots > playerCount) {
      throw new TooManyPlayersForRolesError(usedSlots, playerCount);
    }

    const villagerCount = Math.max(minimumVillagerCount, playerCount - usedSlots);

    const plan: RoleDistributionPlan = {
      [RoleId.WEREWOLF]: werewolfCount,
    };
    for (const roleId of uniqueSpecials) {
      plan[roleId] = 1; // Phase 1: each special role appears at most once
    }
    if (villagerCount > 0) {
      plan[RoleId.VILLAGER] = villagerCount;
    }

    return plan;
  }
}
