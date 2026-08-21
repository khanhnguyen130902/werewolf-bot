import { NightResolver } from '../../src/engine/night/NightResolver';
import { NightActionType, RoleId, Team } from '../../src/engine/domain/enums';
import { RoomFactory, RoomState } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RandomPort } from '../../src/engine/ports/RandomPort';
import { NightActionSubmission } from '../../src/engine/night/NightAction';

class DeterministicRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

function roomWithPlayers(): RoomState {
  const room = RoomFactory.create({ id: 'night-room', hostTelegramId: 'mage', chatId: 'chat', now: 1 });
  room.matchId = 'match-1';
  room.currentRound = 1;
  const definitions: Array<[string, RoleId, Team]> = [
    ['mage', RoleId.SILENT_MAGE, Team.VILLAGE],
    ['target', RoleId.VILLAGER, Team.VILLAGE],
    ['wolf', RoleId.WEREWOLF, Team.WEREWOLF],
  ];
  for (const [id, role, team] of definitions) {
    room.players[id] = { ...PlayerFactory.create({ telegramId: id, nickname: id, joinedAt: 1 }), role, team };
  }
  return room;
}

function action(actorTelegramId: string, targetTelegramId: string | null): NightActionSubmission {
  return {
    actionId: `${actorTelegramId}-silence`,
    actorTelegramId,
    actionType: NightActionType.SILENT_MAGE_SILENCE,
    targetTelegramId,
    round: 1,
  };
}

describe('Silent Mage night resolution', () => {
  it('applies silence after Witch poison when target survives', () => {
    const room = roomWithPlayers();
    const resolver = new NightResolver(new DeterministicRandom());
    const result = resolver.resolve({
      room,
      submissions: [action('mage', 'target')],
      getHunterDecision: () => null,
    });

    expect(result.room.silencedPlayerId).toBe('target');
    expect(result.room.players.target.silencedUntilRound).toBe(1);
    expect(result.room.players.target.alive).toBe(true);
  });

  it('keeps a submitted silence action final when the caster dies in the same night', () => {
    const room = roomWithPlayers();
    const resolver = new NightResolver(new DeterministicRandom());
    const result = resolver.resolve({
      room,
      submissions: [action('mage', 'target'), {
        actionId: 'wolf-kill',
        actorTelegramId: 'wolf',
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: 'mage',
        round: 1,
      }],
      getHunterDecision: () => null,
    });

    expect(result.room.players.mage.alive).toBe(false);
    expect(result.room.silencedPlayerId).toBe('target');
  });

  it('does not persist silence when target dies in the same night', () => {
    const room = roomWithPlayers();
    const resolver = new NightResolver(new DeterministicRandom());
    const result = resolver.resolve({
      room,
      submissions: [action('mage', 'target'), {
        actionId: 'wolf-kill',
        actorTelegramId: 'wolf',
        actionType: NightActionType.WEREWOLF_VOTE_KILL,
        targetTelegramId: 'target',
        round: 1,
      }],
      getHunterDecision: () => null,
    });

    expect(result.room.players.target.alive).toBe(false);
    expect(result.room.silencedPlayerId).toBeNull();
    expect(result.room.players.target.silencedUntilRound).toBeNull();
  });
});
