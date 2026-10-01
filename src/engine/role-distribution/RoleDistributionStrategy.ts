import { RoleId } from '../domain/enums';
import { MAX_SUPPORTED_PLAYERS, MIN_SUPPORTED_PLAYERS } from '../domain/Room';
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
   * @param enabledSpecialRoles special roles configured in GameSettings.enabledRoles.
   *   An empty list selects the player-count default preset; a non-empty list is
   *   used exactly as configured. If the requested roles cannot fit, throws
   *   TooManyPlayersForRolesError.
   */
  computeDistribution(
    playerCount: number,
    enabledSpecialRoles: RoleId[],
  ): RoleDistributionPlan;
}

// These roles are used by the default presets only. They are not auto-enabled
// when the Host supplies a non-empty enabledRoles list.
const DEFAULT_SPECIAL_ROLES: RoleId[] = [
  RoleId.SEER,
  RoleId.BODYGUARD,
  RoleId.HUNTER,
  RoleId.WITCH,
];

// All roles that may be explicitly enabled through room.settings.enabledRoles.
const SUPPORTED_SPECIAL_ROLES: RoleId[] = [
  ...DEFAULT_SPECIAL_ROLES,
  RoleId.SILENT_MAGE,
];

/**
 * Default Phase 1 distribution strategy.
 *
 * Rule set:
 * - Werewolf count is derived from the player count, but it is capped so the
 *   final plan still leaves room for at least one villager.
 * - If enabledSpecialRoles is empty, use the default preset for the player count.
 * - If enabledSpecialRoles is non-empty, use exactly those supported special roles;
 *   never add roles from the default preset.
 * - The 6-player default preset intentionally omits Hunter; Hunter starts at 7 players.
 * - The 8+ player default preset adds Silent Mage alongside the other defaults.
 */
export class DefaultPhase1DistributionStrategy implements RoleDistributionStrategy {
  readonly id = 'default-phase1';

  computeDistribution(
    playerCount: number,
    enabledSpecialRoles: RoleId[],
  ): RoleDistributionPlan {
    if (playerCount < MIN_SUPPORTED_PLAYERS || !Number.isInteger(playerCount)) {
      throw new NotEnoughPlayersError(playerCount, MIN_SUPPORTED_PLAYERS);
    }
    if (playerCount > MAX_SUPPORTED_PLAYERS) {
      throw new TooManyPlayersForRolesError(playerCount, MAX_SUPPORTED_PLAYERS);
    }


    const requestedSpecialRoles = [...new Set(enabledSpecialRoles)];
    const unsupportedRoles = requestedSpecialRoles.filter(
      (roleId) => !SUPPORTED_SPECIAL_ROLES.includes(roleId),
    );
    if (unsupportedRoles.length > 0) {
      throw new Error(
        `Unsupported special roles configured: ${unsupportedRoles.join(', ')}`,
      );
    }

    const selectedSpecialRoles = this.getSelectedSpecialRoles(
      playerCount,
      requestedSpecialRoles,
    );
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

  private getSelectedSpecialRoles(
    playerCount: number,
    explicitSpecials: RoleId[],
  ): RoleId[] {
    if (explicitSpecials.length > 0) {
      return explicitSpecials;
    }
    if (playerCount === 6) {
      return [RoleId.SEER, RoleId.BODYGUARD, RoleId.WITCH];
    }
    if (playerCount === 7) {
      return [...DEFAULT_SPECIAL_ROLES];
    }
    if (playerCount >= 8) {
      return [...DEFAULT_SPECIAL_ROLES, RoleId.SILENT_MAGE];
    }
    return [];
  }
}
