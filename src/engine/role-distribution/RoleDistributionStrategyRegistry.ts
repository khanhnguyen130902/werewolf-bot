import {
  RoleDistributionStrategy,
  DefaultPhase1DistributionStrategy,
} from './RoleDistributionStrategy';

/**
 * Resolves a GameSettings.roleDistributionStrategy string id to its
 * implementation. Mirrors RoleRegistry's extensibility pattern: adding a new
 * distribution strategy (e.g. a "hardcore" or "beginner-friendly" preset for
 * Phase 2/3 game modes) means registering one more class here — no changes
 * to RoomService, GameService, or RoleAssigner.
 */
export class RoleDistributionStrategyRegistry {
  private strategies = new Map<string, RoleDistributionStrategy>();

  register(strategy: RoleDistributionStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  get(id: string): RoleDistributionStrategy {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`No role distribution strategy registered for id "${id}"`);
    }
    return strategy;
  }
}

export function createDefaultDistributionStrategyRegistry(): RoleDistributionStrategyRegistry {
  const registry = new RoleDistributionStrategyRegistry();
  registry.register(new DefaultPhase1DistributionStrategy());
  return registry;
}
