import { RoleId, Team, NightActionType } from '../domain/enums';

/**
 * Static metadata describing a role — used for role-distribution planning,
 * UI display (role list, /roles command), and validation, without needing to
 * instantiate the role's behavior logic.
 */
export interface RoleDefinition {
  id: RoleId;
  team: Team;
  /** Human-readable name key (actual display string resolved by the
   * Telegram presenter's i18n layer — engine stays language-agnostic). */
  nameKey: string;
  /** Whether this role has an action to perform at night. Villager has none. */
  hasNightAction: boolean;
  /** The night action type this role performs, if any. */
  nightActionType: NightActionType | null;
  /**
   * Whether this role reacts to its own death (e.g. Hunter fires a revenge
   * shot). Purely a capability flag; actual trigger conditions are evaluated
   * by the role's `onDeath` hook.
   */
  reactsToOwnDeath: boolean;
}

/**
 * Context passed into a role's night-action validation/resolution hooks.
 * Deliberately minimal and read-only — roles must not mutate GameContext
 * directly; they return descriptions of effects, which the NightResolver
 * (Phase 3) applies centrally. This keeps all state mutation auditable in
 * one place instead of scattered across role classes.
 */
export interface NightActionContext {
  actorTelegramId: string;
  targetTelegramId: string | null;
  alivePlayerIds: string[];
  /** telegramId -> RoleId, for roles that need to know others' roles (e.g. Seer). */
  rolesByPlayer: Record<string, RoleId>;
  round: number;
  settings: Record<string, unknown>;
}

/**
 * Contract every role must implement (Strategy Pattern). Adding a new role
 * (Phase 2 roadmap: Cupid, Elder, Cursed, Thief) means creating one new class
 * that implements this interface and registering it in RoleRegistry — no
 * changes to GameStateMachine, NightResolver, or any other engine module.
 */
export interface IRole {
  readonly definition: RoleDefinition;

  /**
   * Validates whether a proposed night action target is legal for this role
   * given the current context. Throws a DomainError subclass on violation
   * (e.g. InvalidTargetError). Must NOT mutate any state.
   */
  validateNightAction(context: NightActionContext): void;
}
