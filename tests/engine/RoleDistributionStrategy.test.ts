import { DefaultPhase1DistributionStrategy } from '../../src/engine/role-distribution/RoleDistributionStrategy';
import { RoleId } from '../../src/engine/domain/enums';
import {
  TooManyPlayersForRolesError,
  NotEnoughPlayersError,
} from '../../src/engine/errors/DomainError';

describe('DefaultPhase1DistributionStrategy', () => {
  const strategy = new DefaultPhase1DistributionStrategy();

  it('computes 1 werewolf for 6 players (floor(6/4)=1)', () => {
    const plan = strategy.computeDistribution(6, []);
    expect(plan[RoleId.WEREWOLF]).toBe(1);
    expect(plan[RoleId.VILLAGER]).toBe(5);
  });

  it('computes floor(playerCount/4) werewolves, minimum 1', () => {
    expect(strategy.computeDistribution(3, [])[RoleId.WEREWOLF]).toBe(1); // floor(3/4)=0 -> min 1
    expect(strategy.computeDistribution(8, [])[RoleId.WEREWOLF]).toBe(2); // floor(8/4)=2
    expect(strategy.computeDistribution(11, [])[RoleId.WEREWOLF]).toBe(2); // floor(11/4)=2
    expect(strategy.computeDistribution(12, [])[RoleId.WEREWOLF]).toBe(3); // floor(12/4)=3
    expect(strategy.computeDistribution(20, [])[RoleId.WEREWOLF]).toBe(5); // floor(20/4)=5
  });

  it('uses at least 2 werewolves when the room has 5 or more players', () => {
    expect(strategy.computeDistribution(5, [])[RoleId.WEREWOLF]).toBe(2);
    expect(strategy.computeDistribution(8, [])[RoleId.WEREWOLF]).toBe(2);
    expect(strategy.computeDistribution(12, [])[RoleId.WEREWOLF]).toBe(3);
  });

  it('includes only host-enabled special roles, one slot each', () => {
    const plan = strategy.computeDistribution(10, [
      RoleId.SEER,
      RoleId.WITCH,
    ]);
    expect(plan[RoleId.SEER]).toBe(1);
    expect(plan[RoleId.WITCH]).toBe(1);
    expect(plan[RoleId.BODYGUARD]).toBeUndefined();
    expect(plan[RoleId.HUNTER]).toBeUndefined();
    // wolves = floor(10/4) = 2; specials = 2; villagers = 10-2-2 = 6
    expect(plan[RoleId.WEREWOLF]).toBe(2);
    expect(plan[RoleId.VILLAGER]).toBe(6);
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
    expect(plan[RoleId.VILLAGER]).toBe(4); // 10-2-4=4
  });

  it('omits Villager entirely when werewolves + specials exactly fill all slots', () => {
    // 6 players, 1 wolf minimum, 4 specials enabled but only if it fits: 1+4=5 <= 6
    const plan = strategy.computeDistribution(5, [
      RoleId.SEER,
      RoleId.BODYGUARD,
      RoleId.HUNTER,
      RoleId.WITCH,
    ]);
    expect(plan[RoleId.WEREWOLF]).toBe(1);
    expect(plan[RoleId.VILLAGER]).toBeUndefined();
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

  it('throws NotEnoughPlayersError for zero or negative player count', () => {
    expect(() => strategy.computeDistribution(0, [])).toThrow(NotEnoughPlayersError);
  });

  it('ignores non-special role ids passed in enabledSpecialRoles defensively', () => {
    const plan = strategy.computeDistribution(6, [RoleId.WEREWOLF, RoleId.VILLAGER]);
    // Werewolf/Villager aren't in SPECIAL_ROLES so they should be filtered out,
    // leaving werewolf count computed normally and no accidental double-counting.
    expect(plan[RoleId.WEREWOLF]).toBe(1);
    expect(plan[RoleId.VILLAGER]).toBe(5);
  });
});
