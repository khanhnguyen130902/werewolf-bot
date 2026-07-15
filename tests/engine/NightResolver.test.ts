import { NightResolver } from '../../src/engine/night/NightResolver';
import { RoomFactory, DEFAULT_GAME_SETTINGS, RoomState } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RoleId, Team, NightActionType } from '../../src/engine/domain/enums';
import { RandomPort } from '../../src/engine/ports/RandomPort';

class FirstPickRandom implements RandomPort {
  next(): number {
    return 0;
  }
  shuffle<T>(items: T[]): T[] {
    return [...items];
  }
  pick<T>(items: T[]): T {
    return items[0];
  }
}

function buildRoom(params: {
  players: Array<{ id: string; role: RoleId; team: Team; alive?: boolean }>;
  witchPotions?: { saveUsed: boolean; poisonUsed: boolean } | null;
  settingsOverride?: Partial<typeof DEFAULT_GAME_SETTINGS>;
}): RoomState {
  const room = RoomFactory.create({
    id: 'room1',
    hostTelegramId: params.players[0].id,
    chatId: 'chat1',
    now: 1000,
    settingsOverride: params.settingsOverride,
  });
  for (const p of params.players) {
    const player = PlayerFactory.create({ telegramId: p.id, nickname: p.id, joinedAt: 0 });
    player.role = p.role;
    player.team = p.team;
    player.alive = p.alive ?? true;
    room.players[p.id] = player;
  }
  room.currentRound = 1;
  room.witchPotions = params.witchPotions ?? null;
  return room;
}

describe('NightResolver', () => {
  const noHunterDecision = () => null;

  it('kills the werewolf-chosen victim when unprotected', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom, result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });

    expect(result.deaths).toEqual([{ telegramId: 'villager1', cause: 'WEREWOLF_KILL' }]);
    expect(updatedRoom.players['villager1'].alive).toBe(false);
  });

  it('requires two werewolves to agree on the same target before a kill is finalized', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'wolf2', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
        { id: 'villager2', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'wolf2',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager2',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });

    expect(result.deaths).toEqual([]);
  });

  it('CONFIRMED RULE: Bodyguard protection saves the werewolf target', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'bg1', role: RoleId.BODYGUARD, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'bg1',
          actionType: NightActionType.BODYGUARD_PROTECT,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
  });

  it('CONFIRMED RULE: Witch save AND Bodyguard protect on same victim both apply, victim survives, potion still consumed', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'bg1', role: RoleId.BODYGUARD, team: Team.VILLAGE },
        { id: 'witch1', role: RoleId.WITCH, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
      witchPotions: { saveUsed: false, poisonUsed: false },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom, result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'bg1',
          actionType: NightActionType.BODYGUARD_PROTECT,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a3',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_SAVE,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
    expect(updatedRoom.witchPotions?.saveUsed).toBe(true);
  });

  it('CONFIRMED RULE: Witch may save herself if she is the werewolf victim', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'witch1', role: RoleId.WITCH, team: Team.VILLAGE },
      ],
      witchPotions: { saveUsed: false, poisonUsed: false },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom, result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'witch1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_SAVE,
          targetTelegramId: 'witch1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
    expect(updatedRoom.players['witch1'].alive).toBe(true);
  });

  it('Witch poison kills a target independent of werewolf kill/protection', () => {
    const room = buildRoom({
      players: [
        { id: 'witch1', role: RoleId.WITCH, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
      witchPotions: { saveUsed: false, poisonUsed: false },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_POISON,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([{ telegramId: 'villager1', cause: 'WITCH_POISON' }]);
  });

  it('CONFIRMED RULE (default): Witch may use both save and poison in the same night', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'witch1', role: RoleId.WITCH, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
        { id: 'villager2', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
      witchPotions: { saveUsed: false, poisonUsed: false },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom, result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_SAVE,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a3',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_POISON,
          targetTelegramId: 'villager2',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([{ telegramId: 'villager2', cause: 'WITCH_POISON' }]);
    expect(updatedRoom.witchPotions).toEqual({ saveUsed: true, poisonUsed: true });
  });

  it('rejects poison usage when potion already used (no potion left)', () => {
    const room = buildRoom({
      players: [
        { id: 'witch1', role: RoleId.WITCH, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
      witchPotions: { saveUsed: false, poisonUsed: true },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'witch1',
          actionType: NightActionType.WITCH_POISON,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
    expect(result.rejectedActions).toEqual([
      { actionId: 'a1', reason: 'NO_POTION_LEFT:poison' },
    ]);
  });

  it('CONFIRMED RULE: Seer killed the same night still receives inspection result', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'seer1', role: RoleId.SEER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom, result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'seer1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'seer1',
          actionType: NightActionType.SEER_INSPECT,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });

    expect(updatedRoom.players['seer1'].alive).toBe(false);
    expect(result.seerResults).toEqual([
      {
        seerTelegramId: 'seer1',
        targetTelegramId: 'villager1',
        revealedTeam: Team.VILLAGE,
        revealedRole: null,
      },
    ]);
  });

  it('Seer result reveals exact role when seerRevealsExactRole setting is true', () => {
    const room = buildRoom({
      players: [
        { id: 'seer1', role: RoleId.SEER, team: Team.VILLAGE },
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
      ],
      settingsOverride: { seerRevealsExactRole: true },
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'seer1',
          actionType: NightActionType.SEER_INSPECT,
          targetTelegramId: 'wolf1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.seerResults[0].revealedRole).toBe(RoleId.WEREWOLF);
  });

  it('resolves Hunter revenge shot when Hunter dies to werewolf kill', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'hunter1', role: RoleId.HUNTER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'hunter1',
          round: 1,
        },
      ],
      getHunterDecision: (id) =>
        id === 'hunter1' ? { targetTelegramId: 'villager1' } : null,
    });
    expect(result.deaths).toEqual([
      { telegramId: 'hunter1', cause: 'WEREWOLF_KILL' },
      { telegramId: 'villager1', cause: 'HUNTER_SHOT' },
    ]);
  });

  it('resets per-night protected/poisoned flags for the next round', () => {
    const room = buildRoom({
      players: [
        { id: 'bg1', role: RoleId.BODYGUARD, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    room.players['villager1'].protected = true;
    const resolver = new NightResolver(new FirstPickRandom());
    const { room: updatedRoom } = resolver.resolve({
      room,
      submissions: [],
      getHunterDecision: noHunterDecision,
    });
    expect(updatedRoom.players['villager1'].protected).toBe(false);
  });

  it('accepts the werewolf kill when both werewolves choose the same target', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'wolf2', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
        { id: 'villager2', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'wolf2',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([{ telegramId: 'villager1', cause: 'WEREWOLF_KILL' }]);
  });

  it('does not finalize a kill when the two werewolves pick different targets', () => {
    const twoWolfRoom = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'wolf2', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
        { id: 'villager2', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room: twoWolfRoom,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'wolf2',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'villager2',
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
  });

  it('no death occurs if werewolves submit no valid target', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const { result } = resolver.resolve({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: null,
          round: 1,
        },
      ],
      getHunterDecision: noHunterDecision,
    });
    expect(result.deaths).toEqual([]);
  });
});

describe('NightResolver split API (resolveWithoutHunterRevenge / applyHunterRevengeAndFinalize)', () => {
  const noHunterDecision = () => null;

  it('resolveWithoutHunterRevenge identifies a pending Hunter without applying any deaths yet', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'hunter1', role: RoleId.HUNTER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const stepOne = resolver.resolveWithoutHunterRevenge({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'hunter1',
          round: 1,
        },
      ],
    });

    expect(stepOne.depth0Deaths).toEqual([{ telegramId: 'hunter1', cause: 'WEREWOLF_KILL' }]);
    expect(stepOne.pendingHunterTelegramIds).toEqual(['hunter1']);
    // Room player state must NOT be mutated by step one -- hunter1 still alive.
    expect(room.players['hunter1'].alive).toBe(true);
  });

  it('applyHunterRevengeAndFinalize applies both the original death and the Hunter revenge shot', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'hunter1', role: RoleId.HUNTER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const stepOne = resolver.resolveWithoutHunterRevenge({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'hunter1',
          round: 1,
        },
      ],
    });

    // Simulate an awaited Telegram prompt for the pending Hunter.
    const { room: finalRoom, result } = resolver.applyHunterRevengeAndFinalize({
      room,
      stepOneResult: stepOne,
      hunterDecisions: { hunter1: { targetTelegramId: 'villager1' } },
    });

    expect(result.deaths).toEqual([
      { telegramId: 'hunter1', cause: 'WEREWOLF_KILL' },
      { telegramId: 'villager1', cause: 'HUNTER_SHOT' },
    ]);
    expect(finalRoom.players['hunter1'].alive).toBe(false);
    expect(finalRoom.players['villager1'].alive).toBe(false);
  });

  it('applyHunterRevengeAndFinalize with a declined/timed-out decision applies only the original death', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'hunter1', role: RoleId.HUNTER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const stepOne = resolver.resolveWithoutHunterRevenge({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'hunter1',
          round: 1,
        },
      ],
    });

    const { result } = resolver.applyHunterRevengeAndFinalize({
      room,
      stepOneResult: stepOne,
      hunterDecisions: { hunter1: null },
    });

    expect(result.deaths).toEqual([{ telegramId: 'hunter1', cause: 'WEREWOLF_KILL' }]);
  });

  it('preserves the Seer-result-before-death rule across the split (async-gap) flow', () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'seer1', role: RoleId.SEER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const stepOne = resolver.resolveWithoutHunterRevenge({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'seer1',
          round: 1,
        },
        {
          actionId: 'a2',
          actorTelegramId: 'seer1',
          actionType: NightActionType.SEER_INSPECT,
          targetTelegramId: 'villager1',
          round: 1,
        },
      ],
    });

    expect(stepOne.pendingHunterTelegramIds).toEqual([]); // no Hunter involved this round
    expect(stepOne.seerResults).toEqual([
      {
        seerTelegramId: 'seer1',
        targetTelegramId: 'villager1',
        revealedTeam: Team.VILLAGE,
        revealedRole: null,
      },
    ]);

    const { room: finalRoom, result } = resolver.applyHunterRevengeAndFinalize({
      room,
      stepOneResult: stepOne,
      hunterDecisions: {},
    });

    expect(finalRoom.players['seer1'].alive).toBe(false);
    expect(result.seerResults).toHaveLength(1); // result still carries it through
  });

  it('supports a real async await between the two steps', async () => {
    const room = buildRoom({
      players: [
        { id: 'wolf1', role: RoleId.WEREWOLF, team: Team.WEREWOLF },
        { id: 'hunter1', role: RoleId.HUNTER, team: Team.VILLAGE },
        { id: 'villager1', role: RoleId.VILLAGER, team: Team.VILLAGE },
      ],
    });
    const resolver = new NightResolver(new FirstPickRandom());
    const stepOne = resolver.resolveWithoutHunterRevenge({
      room,
      submissions: [
        {
          actionId: 'a1',
          actorTelegramId: 'wolf1',
          actionType: NightActionType.WEREWOLF_VOTE_KILL,
          targetTelegramId: 'hunter1',
          round: 1,
        },
      ],
    });

    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of stepOne.pendingHunterTelegramIds) {
      const decision = await new Promise<{ targetTelegramId: string | null }>((resolve) => {
        setTimeout(() => resolve({ targetTelegramId: 'villager1' }), 5);
      });
      hunterDecisions[hunterId] = decision;
    }

    const { result } = resolver.applyHunterRevengeAndFinalize({
      room,
      stepOneResult: stepOne,
      hunterDecisions,
    });

    expect(result.deaths.map((d) => d.telegramId)).toEqual(['hunter1', 'villager1']);
  });
});
