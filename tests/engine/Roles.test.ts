import { WerewolfRole } from '../../src/engine/roles/WerewolfRole';
import { VillagerRole } from '../../src/engine/roles/VillagerRole';
import { SeerRole } from '../../src/engine/roles/SeerRole';
import { BodyguardRole } from '../../src/engine/roles/BodyguardRole';
import { HunterRole } from '../../src/engine/roles/HunterRole';
import { WitchRole } from '../../src/engine/roles/WitchRole';
import { RoleId } from '../../src/engine/domain/enums';
import { NightActionContext } from '../../src/engine/roles/IRole';
import {
  InvalidTargetError,
  NoPotionLeftError,
} from '../../src/engine/errors/DomainError';

function baseContext(overrides: Partial<NightActionContext> = {}): NightActionContext {
  return {
    actorTelegramId: 'actor',
    targetTelegramId: 'target',
    alivePlayerIds: ['actor', 'target', 'other'],
    rolesByPlayer: {
      actor: RoleId.SEER,
      target: RoleId.VILLAGER,
      other: RoleId.WEREWOLF,
    },
    round: 1,
    settings: {},
    ...overrides,
  };
}

describe('WerewolfRole', () => {
  const role = new WerewolfRole();

  it('allows targeting a living non-werewolf', () => {
    expect(() => role.validateNightAction(baseContext())).not.toThrow();
  });

  it('rejects targeting a dead player', () => {
    const ctx = baseContext({ alivePlayerIds: ['actor', 'other'] });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });

  it('rejects targeting another werewolf', () => {
    const ctx = baseContext({
      targetTelegramId: 'other',
      rolesByPlayer: { actor: RoleId.WEREWOLF, other: RoleId.WEREWOLF },
    });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });

  it('allows null target (abstain)', () => {
    const ctx = baseContext({ targetTelegramId: null });
    expect(() => role.validateNightAction(ctx)).not.toThrow();
  });
});

describe('VillagerRole', () => {
  it('has no night action and validate is a safe no-op', () => {
    const role = new VillagerRole();
    expect(role.definition.hasNightAction).toBe(false);
    expect(() => role.validateNightAction(baseContext())).not.toThrow();
  });
});

describe('SeerRole', () => {
  const role = new SeerRole();

  it('allows inspecting a living other player', () => {
    expect(() => role.validateNightAction(baseContext())).not.toThrow();
  });

  it('rejects inspecting self', () => {
    const ctx = baseContext({ targetTelegramId: 'actor' });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });

  it('rejects inspecting a dead player', () => {
    const ctx = baseContext({ alivePlayerIds: ['actor', 'other'] });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });
});

describe('BodyguardRole', () => {
  const role = new BodyguardRole();

  it('allows protecting another living player', () => {
    expect(() => role.validateNightAction(baseContext())).not.toThrow();
  });

  it('rejects self-protect when disallowed by settings', () => {
    const ctx = baseContext({
      targetTelegramId: 'actor',
      settings: { bodyguardAllowSelfProtect: false },
    });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });

  it('allows self-protect when enabled by settings', () => {
    const ctx = baseContext({
      targetTelegramId: 'actor',
      settings: { bodyguardAllowSelfProtect: true },
    });
    expect(() => role.validateNightAction(ctx)).not.toThrow();
  });

  it('rejects protecting a dead player', () => {
    const ctx = baseContext({ alivePlayerIds: ['actor', 'other'] });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });
});

describe('HunterRole', () => {
  const role = new HunterRole();

  it('allows shooting another living player', () => {
    expect(() => role.validateNightAction(baseContext())).not.toThrow();
  });

  it('rejects shooting self', () => {
    const ctx = baseContext({ targetTelegramId: 'actor' });
    expect(() => role.validateNightAction(ctx)).toThrow(InvalidTargetError);
  });

  it('allows declining to shoot (null target)', () => {
    const ctx = baseContext({ targetTelegramId: null });
    expect(() => role.validateNightAction(ctx)).not.toThrow();
  });
});

describe('WitchRole', () => {
  const role = new WitchRole();

  describe('validateSaveAction', () => {
    it('allows saving a living player when potion available', () => {
      expect(() => role.validateSaveAction(baseContext(), true)).not.toThrow();
    });

    it('allows saving self when the Witch is the werewolf victim', () => {
      const ctx = baseContext({ targetTelegramId: 'actor' });
      expect(() => role.validateSaveAction(ctx, true)).not.toThrow();
    });

    it('throws NoPotionLeftError when save potion already used', () => {
      expect(() => role.validateSaveAction(baseContext(), false)).toThrow(
        NoPotionLeftError,
      );
    });

    it('allows null target (decline to save)', () => {
      const ctx = baseContext({ targetTelegramId: null });
      expect(() => role.validateSaveAction(ctx, false)).not.toThrow();
    });
  });

  describe('validatePoisonAction', () => {
    it('allows poisoning a living player when potion available', () => {
      expect(() =>
        role.validatePoisonAction(baseContext(), true, true, false),
      ).not.toThrow();
    });

    it('throws NoPotionLeftError when poison potion already used', () => {
      expect(() =>
        role.validatePoisonAction(baseContext(), false, true, false),
      ).toThrow(NoPotionLeftError);
    });

    it('rejects poisoning self', () => {
      const ctx = baseContext({ targetTelegramId: 'actor' });
      expect(() => role.validatePoisonAction(ctx, true, true, false)).toThrow(
        InvalidTargetError,
      );
    });

    it('rejects using poison after save when dual potion disabled', () => {
      expect(() =>
        role.validatePoisonAction(baseContext(), true, false, true),
      ).toThrow(InvalidTargetError);
    });

    it('allows using poison after save when dual potion enabled (confirmed default)', () => {
      expect(() =>
        role.validatePoisonAction(baseContext(), true, true, true),
      ).not.toThrow();
    });
  });
});
