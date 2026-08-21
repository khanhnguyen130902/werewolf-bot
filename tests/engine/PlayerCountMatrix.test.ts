import { MAX_SUPPORTED_PLAYERS, MIN_SUPPORTED_PLAYERS, RoomFactory } from '../../src/engine/domain/Room';
import { RoleId, RoomStatus, GameState } from '../../src/engine/domain/enums';
import { TooManyPlayersForRolesError, NotEnoughPlayersError } from '../../src/engine/errors/DomainError';
import { DefaultPhase1DistributionStrategy } from '../../src/engine/role-distribution/RoleDistributionStrategy';

describe('player-count and capacity contract', () => {
  const strategy = new DefaultPhase1DistributionStrategy();

  it.each(Array.from({ length: MAX_SUPPORTED_PLAYERS - MIN_SUPPORTED_PLAYERS + 1 }, (_, i) => i + MIN_SUPPORTED_PLAYERS))(
    'produces a complete valid distribution for %i players',
    (playerCount) => {
      const plan = strategy.computeDistribution(playerCount, []);
      const total = Object.values(plan).reduce((sum, count) => sum + (count ?? 0), 0);
      expect(total).toBe(playerCount);
      expect(plan[RoleId.WEREWOLF]).toBeGreaterThanOrEqual(1);
      expect(Object.values(plan).every((count) => Number.isInteger(count) && (count ?? 0) >= 1)).toBe(true);
      expect(Object.keys(plan).every((role) => Object.values(RoleId).includes(role as RoleId))).toBe(true);
    },
  );

  it.each([16, 17, 100])('rejects distribution above the hard maximum: %i', (playerCount) => {
    expect(() => strategy.computeDistribution(playerCount, [])).toThrow(TooManyPlayersForRolesError);
  });

  it.each([0, -1, 1, 2, 2.5])('rejects invalid below-minimum/non-integer distribution count: %i', (playerCount) => {
    expect(() => strategy.computeDistribution(playerCount, [])).toThrow(NotEnoughPlayersError);
  });

  it('clamps room settings to the supported 3–15 range', () => {
    const room = RoomFactory.create({
      id: 'capacity-room',
      hostTelegramId: 'host',
      chatId: 'chat',
      now: 1000,
      settingsOverride: { minPlayers: 1, maxPlayers: 20 },
    });
    expect(room.status).toBe(RoomStatus.OPEN);
    expect(room.gameState).toBe(GameState.WAITING);
    expect(room.settings.minPlayers).toBe(MIN_SUPPORTED_PLAYERS);
    expect(room.settings.maxPlayers).toBe(MAX_SUPPORTED_PLAYERS);
  });
});
