import { DeathQueue } from '../../src/engine/night/DeathQueue';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RoleId, DeathCause } from '../../src/engine/domain/enums';

function makePlayers(roles: Record<string, RoleId>) {
  const players: Record<string, ReturnType<typeof PlayerFactory.create>> = {};
  for (const [id, role] of Object.entries(roles)) {
    const p = PlayerFactory.create({ telegramId: id, nickname: id, joinedAt: 0 });
    p.role = role;
    players[id] = p;
  }
  return players;
}

describe('DeathQueue', () => {
  const HUNTER_TRIGGERS = [DeathCause.WEREWOLF_KILL, DeathCause.VOTE_EXECUTION, DeathCause.WITCH_POISON];

  it('registers original deaths at depth 0 with no Hunter involved', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ p1: RoleId.VILLAGER, p2: RoleId.SEER });
    const result = queue.resolve(
      [{ telegramId: 'p1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
      () => null,
    );
    expect(result).toEqual([
      { telegramId: 'p1', cause: DeathCause.WEREWOLF_KILL, chainDepth: 0 },
    ]);
  });

  it('triggers Hunter revenge shot when Hunter dies from a trigger cause', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const result = queue.resolve(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
      (hunterId) =>
        hunterId === 'hunter1' ? { hunterTelegramId: hunterId, targetTelegramId: 'victim1' } : null,
    );
    expect(result).toEqual([
      { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL, chainDepth: 0 },
      { telegramId: 'victim1', cause: DeathCause.HUNTER_SHOT, chainDepth: 1 },
    ]);
  });

  it('does NOT trigger revenge if Hunter declines (null target)', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const result = queue.resolve(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
      (hunterId) => ({ hunterTelegramId: hunterId, targetTelegramId: null }),
    );
    expect(result).toHaveLength(1);
  });

  it('does NOT trigger revenge if Hunter decision is undecided (timeout -> null callback result)', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER });
    const result = queue.resolve(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
      () => null,
    );
    expect(result).toHaveLength(1);
  });

  it('does NOT trigger revenge if death cause is not in hunterTriggerCauses', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const result = queue.resolve(
      [{ telegramId: 'hunter1', cause: DeathCause.HUNTER_SHOT }], // e.g. hypothetically excluded cause
      players,
      [DeathCause.WEREWOLF_KILL], // HUNTER_SHOT not in trigger list
      () => ({ hunterTelegramId: 'hunter1', targetTelegramId: 'victim1' }),
    );
    expect(result).toHaveLength(1);
  });

  it('CONFIRMED RULE: a Hunter killed by another Hunter revenge shot does NOT chain further', () => {
    const queue = new DeathQueue();
    const players = makePlayers({
      hunter1: RoleId.HUNTER,
      hunter2: RoleId.HUNTER,
    });
    // hunter1 dies from werewolf kill (depth 0) and shoots hunter2 (depth 1).
    // hunter2 is a Hunter too, but since their death is depth 1 (HUNTER_SHOT,
    // not in trigger causes anyway), they must NOT get to shoot back.
    const result = queue.resolve(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
      (hunterId) => {
        if (hunterId === 'hunter1') {
          return { hunterTelegramId: hunterId, targetTelegramId: 'hunter2' };
        }
        // If (incorrectly) asked about hunter2, this would return a target,
        // but the queue must never call this for hunter2 given the rule.
        return { hunterTelegramId: hunterId, targetTelegramId: 'hunter1' };
      },
    );
    expect(result).toEqual([
      { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL, chainDepth: 0 },
      { telegramId: 'hunter2', cause: DeathCause.HUNTER_SHOT, chainDepth: 1 },
    ]);
    // Exactly 2 deaths -- no further chaining occurred.
    expect(result).toHaveLength(2);
  });

  it('does not double-kill a target already dead from another effect', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const result = queue.resolve(
      [
        { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL },
        { telegramId: 'victim1', cause: DeathCause.WITCH_POISON },
      ],
      players,
      HUNTER_TRIGGERS,
      () => ({ hunterTelegramId: 'hunter1', targetTelegramId: 'victim1' }),
    );
    // victim1 already died from poison; Hunter's shot at the same target
    // must not create a duplicate death entry.
    const victim1Deaths = result.filter((d) => d.telegramId === 'victim1');
    expect(victim1Deaths).toHaveLength(1);
    expect(victim1Deaths[0].cause).toBe(DeathCause.WITCH_POISON);
  });

  it('does not process the same telegramId twice in originalDeaths', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ p1: RoleId.VILLAGER });
    const result = queue.resolve(
      [
        { telegramId: 'p1', cause: DeathCause.WEREWOLF_KILL },
        { telegramId: 'p1', cause: DeathCause.WITCH_POISON },
      ],
      players,
      HUNTER_TRIGGERS,
      () => null,
    );
    expect(result).toHaveLength(1);
  });
});

describe('DeathQueue split API (resolveOriginalDeaths / applyHunterDecisions)', () => {
  const HUNTER_TRIGGERS = [
    DeathCause.WEREWOLF_KILL,
    DeathCause.VOTE_EXECUTION,
    DeathCause.WITCH_POISON,
  ];

  it('resolveOriginalDeaths identifies pending Hunters needing a prompt', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, villager1: RoleId.VILLAGER });
    const { resolved, pendingHunterTelegramIds } = queue.resolveOriginalDeaths(
      [
        { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL },
        { telegramId: 'villager1', cause: DeathCause.WITCH_POISON },
      ],
      players,
      HUNTER_TRIGGERS,
    );
    expect(resolved).toEqual([
      { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL, chainDepth: 0 },
      { telegramId: 'villager1', cause: DeathCause.WITCH_POISON, chainDepth: 0 },
    ]);
    expect(pendingHunterTelegramIds).toEqual(['hunter1']);
  });

  it('resolveOriginalDeaths returns no pending Hunters when death cause is not a trigger', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER });
    const { pendingHunterTelegramIds } = queue.resolveOriginalDeaths(
      [{ telegramId: 'hunter1', cause: DeathCause.HUNTER_SHOT }],
      players,
      [DeathCause.WEREWOLF_KILL], // HUNTER_SHOT not a trigger cause
    );
    expect(pendingHunterTelegramIds).toEqual([]);
  });

  it('applyHunterDecisions appends a depth-1 death for a valid shot decision', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const { resolved } = queue.resolveOriginalDeaths(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
    );
    const final = queue.applyHunterDecisions(resolved, players, {
      hunter1: { hunterTelegramId: 'hunter1', targetTelegramId: 'victim1' },
    });
    expect(final).toEqual([
      { telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL, chainDepth: 0 },
      { telegramId: 'victim1', cause: DeathCause.HUNTER_SHOT, chainDepth: 1 },
    ]);
  });

  it('applyHunterDecisions with a null decision (declined/timeout) adds no extra death', () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER });
    const { resolved } = queue.resolveOriginalDeaths(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
    );
    const final = queue.applyHunterDecisions(resolved, players, { hunter1: null });
    expect(final).toHaveLength(1);
  });

  it('applyHunterDecisions models the async-await gap: caller can await a real prompt between the two steps', async () => {
    const queue = new DeathQueue();
    const players = makePlayers({ hunter1: RoleId.HUNTER, victim1: RoleId.VILLAGER });
    const { resolved, pendingHunterTelegramIds } = queue.resolveOriginalDeaths(
      [{ telegramId: 'hunter1', cause: DeathCause.WEREWOLF_KILL }],
      players,
      HUNTER_TRIGGERS,
    );

    // Simulate an async Telegram prompt-and-await for each pending Hunter.
    const decisions: Record<string, { hunterTelegramId: string; targetTelegramId: string | null } | null> = {};
    for (const hunterId of pendingHunterTelegramIds) {
      const decision = await new Promise<{ hunterTelegramId: string; targetTelegramId: string | null }>(
        (resolve) => {
          setTimeout(() => resolve({ hunterTelegramId: hunterId, targetTelegramId: 'victim1' }), 5);
        },
      );
      decisions[hunterId] = decision;
    }

    const final = queue.applyHunterDecisions(resolved, players, decisions);
    expect(final.map((d) => d.telegramId)).toEqual(['hunter1', 'victim1']);
  });
});
