import { IRole, NightActionContext } from './IRole';
import { RoleId, Team, NightActionType } from '../domain/enums';
import { InvalidTargetError, NoPotionLeftError } from '../errors/DomainError';

/**
 * Witch (Phù thủy). Has one save potion and one poison potion, each usable
 * once per entire match (not per night). After the werewolves act, the Witch
 * learns who the wolves targeted and decides whether to save that victim
 * and/or poison a (possibly different) player.
 *
 * CONFIRMED BUSINESS RULE (product owner decision, overrides the naive
 * default one might assume from "has a save and a poison potion"): unless
 * GameSettings.witchAllowDualPotion is explicitly set to false, the Witch MAY
 * use BOTH potions in the same night. This class exposes two independent
 * validation methods (save / poison) rather than a single combined one,
 * because NightResolver (Phase 3) must be able to process the Witch's save
 * decision and poison decision as two separate sub-actions — the "dual
 * potion" setting only gates whether both are *allowed in the same night*,
 * it does not change the fact they are logically distinct choices.
 */
export class WitchRole implements IRole {
  readonly definition = {
    id: RoleId.WITCH,
    team: Team.VILLAGE,
    nameKey: 'role.witch',
    hasNightAction: true,
    // Witch's "primary" night action type for registry/UI purposes; the
    // resolver distinguishes save vs poison via the two validate* methods
    // and via NightActionType.WITCH_SAVE / WITCH_POISON at the action level.
    nightActionType: NightActionType.WITCH_SAVE,
    reactsToOwnDeath: false,
  };

  /**
   * Validates a save-potion usage.
   * @param hasSavePotionLeft whether the Witch's save potion is still unused
   *   this match (tracked in per-match witch potion state, not PlayerState,
   *   since it persists across the whole match, not just one night).
   */
  validateSaveAction(
    context: NightActionContext,
    hasSavePotionLeft: boolean,
  ): void {
    if (context.targetTelegramId === null) {
      return; // choosing not to save is always valid
    }
    if (!hasSavePotionLeft) {
      throw new NoPotionLeftError('save');
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Save target must be alive');
    }
  }

  /**
   * Validates a poison-potion usage.
   * @param hasPoisonPotionLeft whether the Witch's poison potion is unused.
   * @param allowDualPotion current room setting; when false and the Witch
   *   already used the save potion this same night, poison must be rejected
   *   (and vice versa) — the resolver passes `alreadyUsedOtherPotionThisNight`
   *   to enforce that exclusivity, since this class has no memory of state.
   */
  validatePoisonAction(
    context: NightActionContext,
    hasPoisonPotionLeft: boolean,
    allowDualPotion: boolean,
    alreadyUsedOtherPotionThisNight: boolean,
  ): void {
    if (context.targetTelegramId === null) {
      return;
    }
    if (!hasPoisonPotionLeft) {
      throw new NoPotionLeftError('poison');
    }
    if (!allowDualPotion && alreadyUsedOtherPotionThisNight) {
      throw new InvalidTargetError(
        'Only one potion may be used per night under current settings',
      );
    }
    if (context.targetTelegramId === context.actorTelegramId) {
      throw new InvalidTargetError('Witch cannot poison themselves');
    }
    if (!context.alivePlayerIds.includes(context.targetTelegramId)) {
      throw new InvalidTargetError('Poison target must be alive');
    }
  }

  /** Not used directly — Witch action validation is split into the two
   * methods above since save/poison have different rules. Present only to
   * satisfy the IRole contract. */
  validateNightAction(_context: NightActionContext): void {
    // Intentionally a no-op passthrough; callers must use
    // validateSaveAction/validatePoisonAction instead. See class doc.
  }
}

/**
 * Per-match Witch potion inventory. Lives outside PlayerState because a
 * potion, once used, stays used for the rest of the match — it is match-scoped
 * state, not per-night state like `protected`/`poisoned` flags on Player.
 */
export interface WitchPotionState {
  saveUsed: boolean;
  poisonUsed: boolean;
}

export const INITIAL_WITCH_POTION_STATE: WitchPotionState = {
  saveUsed: false,
  poisonUsed: false,
};
