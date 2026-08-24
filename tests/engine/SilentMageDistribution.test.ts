import { RoleId } from '../../src/engine/domain/enums';
import { DefaultPhase1DistributionStrategy } from '../../src/engine/role-distribution/RoleDistributionStrategy';

describe('Silent Mage explicit distribution', () => {
  const strategy = new DefaultPhase1DistributionStrategy();

  it('auto-enables one Silent Mage instead of one Villager in the default 8-player plan', () => {
    const plan = strategy.computeDistribution(8, []);
    expect(plan).toMatchObject({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.HUNTER]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 1,
    });
  });

  it('uses the expected full Silent Mage preset at 8 players', () => {
    const plan = strategy.computeDistribution(8, [RoleId.SILENT_MAGE]);
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

  it('supports Silent Mage with the full explicit special-role set at 8 players', () => {
    const plan = strategy.computeDistribution(8, [
      RoleId.SEER,
      RoleId.BODYGUARD,
      RoleId.HUNTER,
      RoleId.WITCH,
      RoleId.SILENT_MAGE,
    ]);
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

  it('automatically includes Silent Mage in the default 9-player plan', () => {
    const plan = strategy.computeDistribution(9, []);
    expect(plan).toEqual({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.HUNTER]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 2,
    });
  });

  it('automatically includes Silent Mage at the maximum supported 15 players', () => {
    const plan = strategy.computeDistribution(15, []);
    expect(plan).toMatchObject({
      [RoleId.WEREWOLF]: 3,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 7,
    });
  });

  it('automatically includes Silent Mage at 9 players even when other roles are explicitly listed', () => {
    const plan = strategy.computeDistribution(9, [RoleId.SEER]);
    expect(plan[RoleId.SILENT_MAGE]).toBe(1);
    expect(plan[RoleId.SEER]).toBe(1);
    expect(plan[RoleId.BODYGUARD]).toBe(1);
    expect(plan[RoleId.HUNTER]).toBe(1);
    expect(plan[RoleId.WITCH]).toBe(1);
  });

  it('supports an explicit Silent Mage at 6 players when the plan fits', () => {
    const plan = strategy.computeDistribution(6, [RoleId.SILENT_MAGE]);
    expect(plan).toEqual({
      [RoleId.WEREWOLF]: 2,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 3,
    });
  });
});
