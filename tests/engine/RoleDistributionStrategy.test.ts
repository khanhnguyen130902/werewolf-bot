import { DefaultPhase1DistributionStrategy } from '../../src/engine/role-distribution/RoleDistributionStrategy';
import { RoleId } from '../../src/engine/domain/enums';
import {
  TooManyPlayersForRolesError,
  NotEnoughPlayersError,
} from '../../src/engine/errors/DomainError';

describe('DefaultPhase1DistributionStrategy', () => {
  const strategy = new DefaultPhase1DistributionStrategy();

  it('uses a valid plan for 6 players when all special roles are enabled by default', () => {
    // 6-player distribution is hard-coded: 2 Wolves + Seer + Bodyguard + Witch + 1 Villager
    // (Hunter is NOT included in the 6-player fixed layout)
    const plan = strategy.computeDistribution(6, []);
    expect(plan[RoleId.WEREWOLF]).toBe(2);
    expect(plan[RoleId.SEER]).toBe(1);
    expect(plan[RoleId.BODYGUARD]).toBe(1);
    expect(plan[RoleId.HUNTER]).toBeUndefined();
    expect(plan[RoleId.WITCH]).toBe(1);
    expect(plan[RoleId.VILLAGER]).toBe(1);
  });

  it('computes floor(playerCount/4) werewolves, minimum 1', () => {
    expect(strategy.computeDistribution(3, [])[RoleId.WEREWOLF]).toBe(1); // floor(3/4)=0 -> min 1
    expect(strategy.computeDistribution(8, [])[RoleId.WEREWOLF]).toBe(2); // floor(8/4)=2
    expect(strategy.computeDistribution(11, [])[RoleId.WEREWOLF]).toBe(2); // floor(11/4)=2
    expect(strategy.computeDistribution(12, [])[RoleId.WEREWOLF]).toBe(3); // floor(12/4)=3
    expect(strategy.computeDistribution(15, [])[RoleId.WEREWOLF]).toBe(3); // floor(15/4)=3
  });

  it('uses at least 2 werewolves when the room has 5 or more players', () => {
    expect(strategy.computeDistribution(5, [])[RoleId.WEREWOLF]).toBe(2);
    expect(strategy.computeDistribution(8, [])[RoleId.WEREWOLF]).toBe(2);
    expect(strategy.computeDistribution(12, [])[RoleId.WEREWOLF]).toBe(3);
  });

  it('enables all special roles for 6+ players when none are explicitly configured', () => {
    const smallPlan = strategy.computeDistribution(5, []);
    expect(smallPlan[RoleId.SEER]).toBeUndefined();
    expect(smallPlan[RoleId.BODYGUARD]).toBeUndefined();

    // 6-player is a fixed layout: 2 Wolves + Seer + Bodyguard + Witch + 1 Villager (no Hunter)
    const sixPlan = strategy.computeDistribution(6, []);
    expect(sixPlan[RoleId.SEER]).toBe(1);
    expect(sixPlan[RoleId.BODYGUARD]).toBe(1);
    expect(sixPlan[RoleId.WITCH]).toBe(1);
    expect(sixPlan[RoleId.HUNTER]).toBeUndefined();

    // 8+ players: all five specials are auto-enabled regardless of explicit configuration
    const largePlan = strategy.computeDistribution(8, []);
    expect(largePlan[RoleId.SEER]).toBe(1);
    expect(largePlan[RoleId.BODYGUARD]).toBe(1);
    expect(largePlan[RoleId.HUNTER]).toBe(1);
    expect(largePlan[RoleId.WITCH]).toBe(1);
  });

  it('includes the automatic full special-role preset at 10 players', () => {
    const plan = strategy.computeDistribution(10, [
      RoleId.SEER,
      RoleId.WITCH,
    ]);
    expect(plan[RoleId.SEER]).toBe(1);
    expect(plan[RoleId.WITCH]).toBe(1);
    expect(plan[RoleId.BODYGUARD]).toBe(1);
    expect(plan[RoleId.HUNTER]).toBe(1);
    expect(plan[RoleId.SILENT_MAGE]).toBe(1);
    // wolves = floor(10/4) = 2; specials = 5; villagers = 10-2-5 = 3
    expect(plan[RoleId.WEREWOLF]).toBe(2);
    expect(plan[RoleId.VILLAGER]).toBe(3);
  });

  it('supports all 4 special roles enabled at once when there is room', () => {
    const plan = strategy.computeDistribution(10, [
      RoleId.SEER,
      RoleId.BODYGUARD,
      RoleId.HUNTER,
      RoleId.WITCH,
    ]);
    expect(plan[RoleId.WEREWOLF]).toBe(2);
    expect(plan[RoleId.SEER]).toBe(1);
    expect(plan[RoleId.BODYGUARD]).toBe(1);
    expect(plan[RoleId.HUNTER]).toBe(1);
    expect(plan[RoleId.WITCH]).toBe(1);
    expect(plan[RoleId.SILENT_MAGE]).toBe(1);
    expect(plan[RoleId.VILLAGER]).toBe(3); // 10-2-5=3
  });

  it('throws when 5-player games need 2 wolves but also have 4 specials enabled', () => {
    expect(() =>
      strategy.computeDistribution(5, [
        RoleId.SEER,
        RoleId.BODYGUARD,
        RoleId.HUNTER,
        RoleId.WITCH,
      ]),
    ).toThrow(TooManyPlayersForRolesError);
  });

  it('throws TooManyPlayersForRolesError when enabled specials do not fit', () => {
    expect(() =>
      strategy.computeDistribution(4, [
        RoleId.SEER,
        RoleId.BODYGUARD,
        RoleId.HUNTER,
        RoleId.WITCH,
      ]),
    ).toThrow(TooManyPlayersForRolesError);
  });

  it('deduplicates repeated role ids in enabledSpecialRoles', () => {
    const plan = strategy.computeDistribution(6, [RoleId.SEER, RoleId.SEER]);
    expect(plan[RoleId.SEER]).toBe(1);
  });

  it('rejects NotEnoughPlayersError for below-minimum player count', () => {
    expect(() => strategy.computeDistribution(0, [])).toThrow(NotEnoughPlayersError);
  });

  it('ignores non-special role ids passed in enabledSpecialRoles defensively', () => {
    // When Werewolf/Villager are passed in enabledSpecialRoles they should be filtered
    // since they are not in SPECIAL_ROLES. For 6 players the fixed layout kicks in,
    // so the result is the same as calling computeDistribution(6, []).
    const plan = strategy.computeDistribution(6, [RoleId.WEREWOLF, RoleId.VILLAGER]);
    // 6-player fixed layout: 2 Wolves + Seer + Bodyguard + Witch + 1 Villager
    expect(plan[RoleId.WEREWOLF]).toBe(2);
    expect(plan[RoleId.VILLAGER]).toBe(1);
  });
});
