import { GameState, RoleId, RoomStatus } from '../../src/engine/domain/enums';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { RoleAssigner } from '../../src/engine/role-distribution/RoleAssigner';
import { createPhase1RoleRegistry } from '../../src/engine/roles/RoleRegistry';
import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';

class IdentityRandom {
  next(): number { return 0; }
  shuffle<T>(items: T[]): T[] { return [...items]; }
  pick<T>(items: T[]): T { return items[0]; }
}

describe('system invariants', () => {
  it('never transitions away from GAME_OVER', () => {
    const machine = new GameStateMachine();
    expect(machine.canTransition(GameState.GAME_OVER, GameState.NIGHT)).toBe(false);
    expect(machine.canTransition(GameState.GAME_OVER, GameState.VOTING)).toBe(false);
  });

  it('assigns every player exactly one role and never duplicates a special role', () => {
    const assigner = new RoleAssigner(new IdentityRandom(), createPhase1RoleRegistry());
    const plan = {
      [RoleId.WEREWOLF]: 2,
      [RoleId.SEER]: 1,
      [RoleId.BODYGUARD]: 1,
      [RoleId.WITCH]: 1,
      [RoleId.SILENT_MAGE]: 1,
      [RoleId.VILLAGER]: 1,
    };
    const assignments = assigner.assign(
      ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      plan,
    );
    expect(assignments).toHaveLength(7);
    expect(new Set(assignments.map((assignment) => assignment.telegramId)).size).toBe(7);
    expect(assignments.filter((assignment) => assignment.roleId === RoleId.SILENT_MAGE)).toHaveLength(1);
  });

  it('does not reuse action IDs and retains exactly one dedup record', async () => {
    const storage = new InMemoryStorageAdapter();
    expect(await storage.recordActionIdIfNew('room1', 'action1', 60)).toBe(true);
    expect(await storage.recordActionIdIfNew('room1', 'action1', 60)).toBe(false);
    expect(await storage.recordActionIdIfNew('room1', 'action2', 60)).toBe(true);
  });

  it('starts a recreated room from clean waiting state without old players/effects', async () => {
    const storage = new InMemoryStorageAdapter();
    const original = RoomFactory.create({ id: 'room1', hostTelegramId: 'host', chatId: 'chat1', now: 1000 });
    original.players.host = PlayerFactory.create({ telegramId: 'host', nickname: 'Host', isHost: true, joinedAt: 1000 });
    original.players.dead = PlayerFactory.create({ telegramId: 'dead', nickname: 'Dead', joinedAt: 1000 });
    original.players.dead.alive = false;
    original.gameState = GameState.GAME_OVER;
    original.status = RoomStatus.LOCKED;
    original.currentRound = 4;
    original.silencedPlayerId = 'dead';
    await storage.saveRoom(original, -1);

    await storage.deleteRoom('room1');
    const recreated = RoomFactory.create({ id: 'room1', hostTelegramId: 'host', chatId: 'chat1', now: 2000 });
    recreated.players.host = PlayerFactory.create({ telegramId: 'host', nickname: 'Host', isHost: true, joinedAt: 2000 });
    await storage.saveRoom(recreated, -1);
    const loaded = await storage.getRoom('room1');

    expect(loaded?.gameState).toBe(GameState.WAITING);
    expect(loaded?.currentRound).toBe(0);
    expect(loaded?.silencedPlayerId).toBeNull();
    expect(loaded?.players.dead).toBeUndefined();
  });
});
