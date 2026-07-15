import { RoleAssigner } from '../../src/engine/role-distribution/RoleAssigner';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { RoleId } from '../../src/engine/domain/enums';

/** Deterministic "random" that reverses arrays instead of shuffling, so
 * assignment order is 100% predictable for assertions. */
class ReverseFakeRandom implements RandomPort {
  next(): number {
    return 0.5;
  }
  shuffle<T>(items: T[]): T[] {
    return [...items].reverse();
  }
  pick<T>(items: T[]): T {
    return items[0];
  }
}

describe('RoleAssigner', () => {
  const registry = createPhase1RoleRegistry();

  it('assigns exactly one role per player and totals match the plan', () => {
    const assigner = new RoleAssigner(new ReverseFakeRandom(), registry);
    const playerIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const plan = {
      [RoleId.WEREWOLF]: 1,
      [RoleId.SEER]: 1,
      [RoleId.VILLAGER]: 4,
    };
    const assignments = assigner.assign(playerIds, plan);

    expect(assignments).toHaveLength(6);
    const roleCounts: Record<string, number> = {};
    for (const a of assignments) {
      roleCounts[a.roleId] = (roleCounts[a.roleId] ?? 0) + 1;
    }
    expect(roleCounts[RoleId.WEREWOLF]).toBe(1);
    expect(roleCounts[RoleId.SEER]).toBe(1);
    expect(roleCounts[RoleId.VILLAGER]).toBe(4);

    // Every player id appears exactly once.
    const assignedIds = assignments.map((a) => a.telegramId).sort();
    expect(assignedIds).toEqual([...playerIds].sort());
  });

  it('throws if plan total does not match player count', () => {
    const assigner = new RoleAssigner(new ReverseFakeRandom(), registry);
    expect(() =>
      assigner.assign(['p1', 'p2'], { [RoleId.WEREWOLF]: 1 }),
    ).toThrow(/totals 1 but there are 2 players/);
  });

  it('throws if plan references an unregistered role', () => {
    const emptyRegistry = createPhase1RoleRegistry();
    const assigner = new RoleAssigner(new ReverseFakeRandom(), emptyRegistry);
    // Force an invalid role id not in the registry by casting.
    const badPlan = { ['NOT_A_ROLE' as RoleId]: 1 };
    expect(() => assigner.assign(['p1'], badPlan)).toThrow(
      /not registered/,
    );
  });
});
