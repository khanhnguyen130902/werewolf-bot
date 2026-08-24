import { SilentMageRole } from '../../src/engine/roles/SilentMageRole';
import { RoleId, Team, NightActionType } from '../../src/engine/domain/enums';
import { InvalidTargetError } from '../../src/engine/errors/DomainError';

describe('SilentMageRole', () => {
  const role = new SilentMageRole();
  const base = {
    actorTelegramId: 'mage',
    targetTelegramId: 'target',
    alivePlayerIds: ['mage', 'target', 'other'],
    rolesByPlayer: {
      mage: RoleId.SILENT_MAGE,
      target: RoleId.VILLAGER,
      other: RoleId.WEREWOLF,
    },
    round: 2,
    settings: {},
  };

  it('exposes village night-action metadata', () => {
    expect(role.definition.id).toBe(RoleId.SILENT_MAGE);
    expect(role.definition.team).toBe(Team.VILLAGE);
    expect(role.definition.nightActionType).toBe(NightActionType.SILENT_MAGE_SILENCE);
    expect(role.definition.reactsToOwnDeath).toBe(false);
  });

  it('allows skip', () => {
    expect(() => role.validateNightAction({ ...base, targetTelegramId: null })).not.toThrow();
  });

  it('rejects self-target', () => {
    expect(() => role.validateNightAction({ ...base, targetTelegramId: 'mage' })).toThrow(InvalidTargetError);
  });

  it('rejects dead or missing target', () => {
    expect(() => role.validateNightAction({ ...base, targetTelegramId: 'dead' })).toThrow(InvalidTargetError);
  });

  it('accepts a valid target; the service enforces consecutive-night restrictions', () => {
    expect(() => role.validateNightAction({ ...base, round: 3 })).not.toThrow();
  });
});
