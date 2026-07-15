import { WinConditionChecker } from '../../src/engine/win-condition/WinConditionChecker';
import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RoleId, Team, WinnerTeam } from '../../src/engine/domain/enums';

function buildRoom(players: Array<{ id: string; team: Team; alive: boolean }>) {
  const room = RoomFactory.create({
    id: 'room1',
    hostTelegramId: players[0].id,
    chatId: 'chat1',
    now: 1000,
  });
  for (const p of players) {
    const player = PlayerFactory.create({ telegramId: p.id, nickname: p.id, joinedAt: 0 });
    player.team = p.team;
    player.role = p.team === Team.WEREWOLF ? RoleId.WEREWOLF : RoleId.VILLAGER;
    player.alive = p.alive;
    room.players[p.id] = player;
  }
  return room;
}

describe('WinConditionChecker', () => {
  const checker = new WinConditionChecker();

  it('Village wins when all werewolves are dead', () => {
    const room = buildRoom([
      { id: 'wolf1', team: Team.WEREWOLF, alive: false },
      { id: 'v1', team: Team.VILLAGE, alive: true },
      { id: 'v2', team: Team.VILLAGE, alive: true },
    ]);
    const result = checker.check(room);
    expect(result.winner).toBe(WinnerTeam.VILLAGE);
    expect(result.aliveWerewolves).toBe(0);
  });

  it('Werewolves win when their count equals village count', () => {
    const room = buildRoom([
      { id: 'wolf1', team: Team.WEREWOLF, alive: true },
      { id: 'v1', team: Team.VILLAGE, alive: true },
    ]);
    const result = checker.check(room);
    expect(result.winner).toBe(WinnerTeam.WEREWOLF);
  });

  it('Werewolves win when their count exceeds village count', () => {
    const room = buildRoom([
      { id: 'wolf1', team: Team.WEREWOLF, alive: true },
      { id: 'wolf2', team: Team.WEREWOLF, alive: true },
      { id: 'v1', team: Team.VILLAGE, alive: true },
    ]);
    const result = checker.check(room);
    expect(result.winner).toBe(WinnerTeam.WEREWOLF);
  });

  it('No winner yet when village outnumbers werewolves and both sides alive', () => {
    const room = buildRoom([
      { id: 'wolf1', team: Team.WEREWOLF, alive: true },
      { id: 'v1', team: Team.VILLAGE, alive: true },
      { id: 'v2', team: Team.VILLAGE, alive: true },
      { id: 'v3', team: Team.VILLAGE, alive: true },
    ]);
    const result = checker.check(room);
    expect(result.winner).toBe(WinnerTeam.NONE);
  });

  it('ignores dead players when counting each side', () => {
    const room = buildRoom([
      { id: 'wolf1', team: Team.WEREWOLF, alive: true },
      { id: 'wolf2', team: Team.WEREWOLF, alive: false }, // dead wolf shouldn't count
      { id: 'v1', team: Team.VILLAGE, alive: true },
      { id: 'v2', team: Team.VILLAGE, alive: false }, // dead villager shouldn't count
    ]);
    const result = checker.check(room);
    expect(result.aliveWerewolves).toBe(1);
    expect(result.aliveVillagers).toBe(1);
    expect(result.winner).toBe(WinnerTeam.WEREWOLF); // 1 >= 1
  });
});
