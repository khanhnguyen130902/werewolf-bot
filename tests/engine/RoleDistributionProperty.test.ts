import { RoleId } from '../../src/engine/domain/enums';
import { MAX_SUPPORTED_PLAYERS, MIN_SUPPORTED_PLAYERS } from '../../src/engine/domain/Room';
import { DefaultPhase1DistributionStrategy } from '../../src/engine/role-distribution/RoleDistributionStrategy';
import { RoleAssigner } from '../../src/engine/role-distribution/RoleAssigner';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { RandomPort } from '../../src/engine/ports/RandomPort';

class SeededRandom implements RandomPort {
  constructor(private seed: number) {}
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0x1_0000_0000;
  }
  shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

function total(plan: Partial<Record<RoleId, number>>): number {
  return Object.values(plan).reduce((sum, count) => sum + (count ?? 0), 0);
}

describe('role distribution randomized properties', () => {
  const strategy = new DefaultPhase1DistributionStrategy();
  const registry = createPhase1RoleRegistry();

  it('preserves complete assignment invariants across 50 seeds for every supported count', () => {
    for (let playerCount = MIN_SUPPORTED_PLAYERS; playerCount <= MAX_SUPPORTED_PLAYERS; playerCount += 1) {
      for (let seed = 1; seed <= 50; seed += 1) {
        const playerIds = Array.from({ length: playerCount }, (_, index) => `p-${playerCount}-${seed}-${index}`);
        const plan = strategy.computeDistribution(playerCount, seed % 2 === 0 ? [] : [RoleId.SILENT_MAGE]);
        const assignments = new RoleAssigner(new SeededRandom(seed), registry).assign(playerIds, plan);
        const assignedCounts = assignments.reduce<Record<string, number>>((counts, assignment) => {
          counts[assignment.roleId] = (counts[assignment.roleId] ?? 0) + 1;
          return counts;
        }, {});

        expect(assignments).toHaveLength(playerCount);
        expect(total(plan)).toBe(playerCount);
        expect(assignedCounts[RoleId.WEREWOLF]).toBeGreaterThanOrEqual(1);
        expect(new Set(assignments.map((assignment) => assignment.telegramId)).size).toBe(playerCount);
        for (const [roleId, count] of Object.entries(assignedCounts)) {
          if (roleId !== RoleId.WEREWOLF && roleId !== RoleId.VILLAGER) {
            expect(count).toBe(1);
          }
        }
      }
    }
  });

  it('uses Silent Mage instead of one Villager in the default 8-player preset', () => {
    const plan = strategy.computeDistribution(8, []);
    expect(plan).toEqual({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.HUNTER]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 1,
    });
  });

  it('keeps the full explicit Silent Mage preset valid from 8 through 15 players', () => {
    const allSpecials = [
      RoleId.SEER,
      RoleId.BODYGUARD,
      RoleId.HUNTER,
      RoleId.WITCH,
      RoleId.SILENT_MAGE,
    ];
    for (let playerCount = 8; playerCount <= MAX_SUPPORTED_PLAYERS; playerCount += 1) {
      const plan = strategy.computeDistribution(playerCount, allSpecials);
      expect(total(plan)).toBe(playerCount);
      expect(plan[RoleId.SILENT_MAGE]).toBe(1);
      expect(plan[RoleId.SEER]).toBe(1);
      expect(plan[RoleId.BODYGUARD]).toBe(1);
      expect(plan[RoleId.HUNTER]).toBe(1);
      expect(plan[RoleId.WITCH]).toBe(1);
    }
  });
});
