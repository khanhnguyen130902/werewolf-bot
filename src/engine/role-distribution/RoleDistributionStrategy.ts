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
 * Default Phase 1 distribution strategy.
 *
 * Rule set:
 * - Werewolf count is derived from the player count, but it is capped so the
 *   final plan still leaves room for at least one villager.
 * - If the host did not explicitly enable any special roles, then 6+ player
 *   games automatically enable all special roles.
 * - If the host explicitly enabled special roles, those roles are used as-is,
 *   provided the plan still fits the player count.
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

    if (playerCount === 1) {
      return {
        [RoleId.WEREWOLF]: 1,
      };
    }

    if (playerCount === 6) {
      return {
        [RoleId.WEREWOLF]: 2,
        [RoleId.SEER]: 1,
        [RoleId.BODYGUARD]: 1,
        [RoleId.WITCH]: 1,
        [RoleId.VILLAGER]: 1,
      };
    }

    const explicitSpecials = enabledSpecialRoles.filter((r) =>
      SPECIAL_ROLES.includes(r),
    );
    const uniqueSpecials = [...new Set(explicitSpecials)];

    const selectedSpecialRoles = this.getSelectedSpecialRoles(playerCount, uniqueSpecials);
    const minimumVillagerCount = 1;
    const maxWerewolves = Math.max(
      1,
      playerCount - selectedSpecialRoles.length - minimumVillagerCount,
    );
    const werewolfCount = Math.max(
      1,
      Math.min(this.getDefaultWerewolfCount(playerCount), maxWerewolves),
    );
    const usedSlots = werewolfCount + selectedSpecialRoles.length;

    if (usedSlots > playerCount - minimumVillagerCount) {
      throw new TooManyPlayersForRolesError(usedSlots, playerCount);
    }

    return this.buildPlan(werewolfCount, selectedSpecialRoles, playerCount, usedSlots);
  }

  private buildPlan(
    werewolfCount: number,
    selectedSpecialRoles: RoleId[],
    playerCount: number,
    usedSlots: number,
  ): RoleDistributionPlan {
    const villagerCount = playerCount - usedSlots;

    const plan: RoleDistributionPlan = {
      [RoleId.WEREWOLF]: werewolfCount,
    };
    for (const roleId of selectedSpecialRoles) {
      plan[roleId] = 1;
    }
    if (villagerCount > 0) {
      plan[RoleId.VILLAGER] = villagerCount;
    }

    return plan;
  }

  private getDefaultWerewolfCount(playerCount: number): number {
    return playerCount >= 5 ? Math.max(2, Math.floor(playerCount / 4)) : 1;
  }

  private getSelectedSpecialRoles(playerCount: number, explicitSpecials: RoleId[]): RoleId[] {
    if (explicitSpecials.length > 0) {
      return explicitSpecials;
    }

    if (playerCount >= 6) {
      return [...SPECIAL_ROLES];
    }

    return [];
  }
}
