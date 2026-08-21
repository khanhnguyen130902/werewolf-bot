import { NightResolver } from '../../src/engine/night/NightResolver';
import { NightActionSubmission } from '../../src/engine/night/NightAction';
import { NightActionType, RoleId, Team, DeathCause, GameState, NightPhase } from '../../src/engine/domain/enums';
import { RoomFactory, RoomState } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RandomPort } from '../../src/engine/ports/RandomPort';

class DeterministicRandom implements RandomPort {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

function buildRoom(): RoomState {
  const room = RoomFactory.create({ id: 'resolution-room', hostTelegramId: 'wolf', chatId: 'chat', now: 1 });
  room.matchId = 'match-resolution';
  room.gameState = GameState.NIGHT;
  room.nightPhase = NightPhase.WITCH;
  room.currentRound = 1;
  room.witchPotions = { saveUsed: false, poisonUsed: false };
  const players: Array<[string, RoleId, Team]> = [
    ['wolf', RoleId.WEREWOLF, Team.WEREWOLF],
    ['guard', RoleId.BODYGUARD, Team.VILLAGE],
    ['seer', RoleId.SEER, Team.VILLAGE],
    ['witch', RoleId.WITCH, Team.VILLAGE],
    ['mage', RoleId.SILENT_MAGE, Team.VILLAGE],
    ['hunter', RoleId.HUNTER, Team.VILLAGE],
    ['victim', RoleId.VILLAGER, Team.VILLAGE],
    ['poisoned', RoleId.VILLAGER, Team.VILLAGE],
    ['silenced', RoleId.VILLAGER, Team.VILLAGE],
  ];
  for (const [telegramId, role, team] of players) {
    room.players[telegramId] = {
      ...PlayerFactory.create({ telegramId, nickname: telegramId, joinedAt: 1 }),
      role,
      team,
    };
  }
  return room;
}

function submissions(): NightActionSubmission[] {
  return [
    { actionId: 'wolf-kill', actorTelegramId: 'wolf', actionType: NightActionType.WEREWOLF_VOTE_KILL, targetTelegramId: 'victim', round: 1 },
    { actionId: 'guard-protect', actorTelegramId: 'guard', actionType: NightActionType.BODYGUARD_PROTECT, targetTelegramId: 'victim', round: 1 },
    { actionId: 'seer-inspect', actorTelegramId: 'seer', actionType: NightActionType.SEER_INSPECT, targetTelegramId: 'wolf', round: 1 },
    { actionId: 'witch-save', actorTelegramId: 'witch', actionType: NightActionType.WITCH_SAVE, targetTelegramId: 'victim', round: 1 },
    { actionId: 'witch-poison', actorTelegramId: 'witch', actionType: NightActionType.WITCH_POISON, targetTelegramId: 'poisoned', round: 1 },
    { actionId: 'mage-silence', actorTelegramId: 'mage', actionType: NightActionType.SILENT_MAGE_SILENCE, targetTelegramId: 'silenced', round: 1 },
  ];
}

function summarize(room: RoomState, actions: NightActionSubmission[]) {
  const result = new NightResolver(new DeterministicRandom()).resolve({
    room,
    submissions: actions,
    getHunterDecision: () => null,
  });
  return {
    deaths: result.result.deaths,
    seerResults: result.result.seerResults,
    witchPotions: result.room.witchPotions,
    silencedPlayerId: result.room.silencedPlayerId,
    alive: Object.fromEntries(Object.entries(result.room.players).map(([id, player]) => [id, player.alive])),
  };
}

describe('deterministic night resolution order', () => {
  it('applies protection/save before final deaths and silence after poison', () => {
    const summary = summarize(buildRoom(), submissions());

    expect(summary.deaths).toEqual([{ telegramId: 'poisoned', cause: DeathCause.WITCH_POISON }]);
    expect(summary.alive.victim).toBe(true);
    expect(summary.alive.poisoned).toBe(false);
    expect(summary.silencedPlayerId).toBe('silenced');
    expect(summary.seerResults).toEqual([expect.objectContaining({
      seerTelegramId: 'seer',
      targetTelegramId: 'wolf',
      revealedTeam: Team.WEREWOLF,
    })]);
    expect(summary.witchPotions).toEqual({ saveUsed: true, poisonUsed: true });
  });

  it('produces the same final result when callback arrival order is reversed', () => {
    const forward = summarize(buildRoom(), submissions());
    const reverse = summarize(buildRoom(), submissions().reverse());
    expect(reverse).toEqual(forward);
  });
});
