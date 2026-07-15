import { RoleId } from '../domain/enums';
import { IRole } from './IRole';
import { WerewolfRole } from './WerewolfRole';
import { VillagerRole } from './VillagerRole';
import { SeerRole } from './SeerRole';
import { BodyguardRole } from './BodyguardRole';
import { HunterRole } from './HunterRole';
import { WitchRole } from './WitchRole';

/**
 * Central registry mapping RoleId -> IRole implementation instance.
 *
 * This is the extensibility seam required by the project instructions
 * ("allow new roles... with minimal code changes"): adding a Phase 2 role
 * like Cupid means:
 *   1. Create `CupidRole implements IRole` in this same directory.
 *   2. Call `registry.register(new CupidRole())` once at bootstrap.
 * No other engine file (state machine, night resolver, distribution
 * strategy) needs to change, since they all consume roles through this
 * registry's interface rather than importing concrete role classes.
 */
export class RoleRegistry {
  private roles = new Map<RoleId, IRole>();

  register(role: IRole): void {
    this.roles.set(role.definition.id, role);
  }

  get(roleId: RoleId): IRole {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`No role registered for id ${roleId}`);
    }
    return role;
  }

  has(roleId: RoleId): boolean {
    return this.roles.has(roleId);
  }

  allRegisteredIds(): RoleId[] {
    return [...this.roles.keys()];
  }
}

/**
 * Builds a registry pre-populated with all Phase 1 roles. Call sites that
 * need Phase 2+ roles later can start from this factory and `.register()`
 * additional roles on top, or construct a bare `new RoleRegistry()` and
 * register a fully custom set (e.g. for a game-mode variant).
 */
export function createPhase1RoleRegistry(): RoleRegistry {
  const registry = new RoleRegistry();
  registry.register(new WerewolfRole());
  registry.register(new VillagerRole());
  registry.register(new SeerRole());
  registry.register(new BodyguardRole());
  registry.register(new HunterRole());
  registry.register(new WitchRole());
  return registry;
}
