import { WerewolfRole } from '../../src/engine/roles/WerewolfRole';
import { VillagerRole } from '../../src/engine/roles/VillagerRole';
import { SeerRole } from '../../src/engine/roles/SeerRole';
import { BodyguardRole } from '../../src/engine/roles/BodyguardRole';
import { HunterRole } from '../../src/engine/roles/HunterRole';
import { WitchRole } from '../../src/engine/roles/WitchRole';
import { SilentMageRole } from '../../src/engine/roles/SilentMageRole';
import { NightActionContext } from '../../src/engine/roles/IRole';
import { RoleId, Team } from '../../src/engine/domain/enums';
import { InvalidTargetError, NoPotionLeftError } from '../../src/engine/errors/DomainError';

function context(overrides: Partial<NightActionContext> = {}): NightActionContext {
  return {
    actorTelegramId: 'actor',
    targetTelegramId: 'other',
    alivePlayerIds: ['actor', 'other', 'third'],
    rolesByPlayer: {
      actor: RoleId.VILLAGER,
      other: RoleId.VILLAGER,
      third: RoleId.WEREWOLF,
    },
    round: 1,
    settings: {
      bodyguardAllowSelfProtect: true,
      allowDualPotion: true,
    },
    ...overrides,
  };
}

describe('All roles acceptance matrix', () => {
  it('registers every supported role with the correct team and capability metadata', () => {
    const roles = [
      new WerewolfRole(),
      new VillagerRole(),
      new SeerRole(),
      new BodyguardRole(),
      new HunterRole(),
      new WitchRole(),
      new SilentMageRole(),
    ];

    expect(roles.map((role) => role.definition.id)).toEqual([
      RoleId.WEREWOLF,
      RoleId.VILLAGER,
      RoleId.SEER,
      RoleId.BODYGUARD,
      RoleId.HUNTER,
      RoleId.WITCH,
      RoleId.SILENT_MAGE,
    ]);
    expect(roles.filter((role) => role.definition.team === Team.WEREWOLF)).toHaveLength(1);
    expect(roles.filter((role) => role.definition.team === Team.VILLAGE)).toHaveLength(6);
    expect(new VillagerRole().definition.hasNightAction).toBe(false);
    expect(new HunterRole().definition.reactsToOwnDeath).toBe(true);
    expect(new SilentMageRole().definition.hasNightAction).toBe(true);
    expect(new SilentMageRole().definition.reactsToOwnDeath).toBe(false);
  });

  describe('Werewolf', () => {
    const role = new WerewolfRole();
    it('accepts a living non-werewolf target', () => {
      expect(() => role.validateNightAction(context({ rolesByPlayer: { actor: RoleId.WEREWOLF, other: RoleId.VILLAGER, third: RoleId.WEREWOLF } }))).not.toThrow();
    });
    it('accepts Skip', () => {
      expect(() => role.validateNightAction(context({ targetTelegramId: null, rolesByPlayer: { actor: RoleId.WEREWOLF, other: RoleId.VILLAGER } }))).not.toThrow();
    });
    it('rejects a dead target', () => {
      expect(() => role.validateNightAction(context({ alivePlayerIds: ['actor'], rolesByPlayer: { actor: RoleId.WEREWOLF, other: RoleId.VILLAGER } }))).toThrow(InvalidTargetError);
    });
  });

  describe('Villager', () => {
    it('has no night action and remains safe if validation is called defensively', () => {
      const role = new VillagerRole();
      expect(role.definition.hasNightAction).toBe(false);
      expect(() => role.validateNightAction(context())).not.toThrow();
    });
  });

  describe('Seer', () => {
    const role = new SeerRole();
    it('accepts inspecting another living player', () => {
      expect(() => role.validateNightAction(context())).not.toThrow();
    });
    it('rejects self and dead targets, while allowing inspection of a werewolf', () => {
      expect(() => role.validateNightAction(context({ targetTelegramId: 'actor' }))).toThrow(InvalidTargetError);
      expect(() => role.validateNightAction(context({ alivePlayerIds: ['actor', 'third'] }))).toThrow(InvalidTargetError);
      expect(() => role.validateNightAction(context({ targetTelegramId: 'third', rolesByPlayer: { actor: RoleId.SEER, third: RoleId.WEREWOLF } }))).not.toThrow();
    });
  });

  describe('Bodyguard', () => {
    const role = new BodyguardRole();
    it('accepts protecting another living player', () => {
      expect(() => role.validateNightAction(context())).not.toThrow();
    });
    it('enforces self-protect setting and living target validation', () => {
      expect(() => role.validateNightAction(context({ targetTelegramId: 'actor', settings: { bodyguardAllowSelfProtect: false } }))).toThrow(InvalidTargetError);
      expect(() => role.validateNightAction(context({ targetTelegramId: 'actor', settings: { bodyguardAllowSelfProtect: true } }))).not.toThrow();
      expect(() => role.validateNightAction(context({ alivePlayerIds: ['actor', 'third'] }))).toThrow(InvalidTargetError);
    });
  });

  describe('Hunter', () => {
    const role = new HunterRole();
    it('accepts a living target and Skip', () => {
      expect(() => role.validateNightAction(context())).not.toThrow();
      expect(() => role.validateNightAction(context({ targetTelegramId: null }))).not.toThrow();
    });
    it('rejects self and dead targets', () => {
      expect(() => role.validateNightAction(context({ targetTelegramId: 'actor' }))).toThrow(InvalidTargetError);
      expect(() => role.validateNightAction(context({ alivePlayerIds: ['actor'] }))).toThrow(InvalidTargetError);
    });
  });

  describe('Silent Mage', () => {
    const role = new SilentMageRole();
    it('accepts a living target and Skip while rejecting self/dead targets', () => {
      expect(() => role.validateNightAction(context({ targetTelegramId: 'other' }))).not.toThrow();
      expect(() => role.validateNightAction(context({ targetTelegramId: null }))).not.toThrow();
      expect(() => role.validateNightAction(context({ targetTelegramId: 'actor' }))).toThrow(InvalidTargetError);
      expect(() => role.validateNightAction(context({ alivePlayerIds: ['actor', 'third'] }))).toThrow(InvalidTargetError);
    });
  });

  describe('Witch', () => {
    const role = new WitchRole();
    it('accepts save with an available potion and allows Skip', () => {
      expect(() => role.validateSaveAction(context(), true)).not.toThrow();
      expect(() => role.validateSaveAction(context({ targetTelegramId: null }), true)).not.toThrow();
    });
    it('rejects save when potion is spent or target is dead', () => {
      expect(() => role.validateSaveAction(context(), false)).toThrow(NoPotionLeftError);
      expect(() => role.validateSaveAction(context({ alivePlayerIds: ['actor'] }), true)).toThrow(InvalidTargetError);
    });
    it('accepts poison for a living non-self target', () => {
      expect(() => role.validatePoisonAction(context(), true, true, false)).not.toThrow();
    });
    it('rejects poison when spent, self-targeted, or dead, while allowing dual potion validation', () => {
      expect(() => role.validatePoisonAction(context(), false, true, false)).toThrow(NoPotionLeftError);
      expect(() => role.validatePoisonAction(context({ targetTelegramId: 'actor' }), true, true, false)).toThrow(InvalidTargetError);
      expect(() => role.validatePoisonAction(context({ alivePlayerIds: ['actor'] }), true, true, false)).toThrow(InvalidTargetError);
      expect(() => role.validatePoisonAction(context(), true, false, true)).not.toThrow();
    });
  });
});
