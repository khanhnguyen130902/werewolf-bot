import { Redis } from 'ioredis';
import { RedisStorageAdapter } from '../../src/infrastructure/redis/RedisStorageAdapter';
import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { ConcurrentModificationError } from '../../src/engine/errors/DomainError';
import { DomainEventType } from '../../src/engine/domain/enums';
import { createEvent, DomainEvent } from '../../src/engine/events/DomainEvent';

// These tests require a real Redis server reachable at REDIS_URL (defaults
// to localhost:6379). They are integration tests, not unit tests: they
// verify actual Lua-script atomicity and TTL behavior that cannot be
// faithfully simulated by the InMemoryStorageAdapter used elsewhere in the
// suite. Each test guards on `redisAvailable` and returns early if Redis is
// unreachable, so `npm test` still passes in environments without Redis.

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let redis: Redis;
let redisAvailable = true;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (redisAvailable) {
    await redis.quit();
  }
});

beforeEach(async () => {
  if (redisAvailable) {
    await redis.flushall();
  }
});

describe('RedisStorageAdapter (integration)', () => {
  it('reports whether Redis is reachable for this test run', () => {
    if (!redisAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        `Redis not reachable at ${REDIS_URL} -- RedisStorageAdapter integration tests will no-op.`,
      );
    }
    expect(true).toBe(true);
  });

  it('getRoom returns null for a non-existent room', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const result = await adapter.getRoom('nope');
    expect(result).toBeNull();
  });

  it('saveRoom(-1) creates a brand-new room and getRoom retrieves it', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r1',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    room.players['host1'] = PlayerFactory.create({
      telegramId: 'host1',
      nickname: 'Host',
      isHost: true,
      joinedAt: 1000,
    });

    const saved = await adapter.saveRoom(room, -1);
    expect(saved.version).toBe(0);

    const fetched = await adapter.getRoom('r1');
    expect(fetched).not.toBeNull();
    expect(fetched!.hostTelegramId).toBe('host1');
    expect(fetched!.players['host1'].nickname).toBe('Host');
  });

  it('saveRoom(-1) fails if the room already exists (double-create guard)', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r2',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    await adapter.saveRoom(room, -1);
    await expect(adapter.saveRoom(room, -1)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    );
  });

  it('saveRoom increments version on successful CAS write', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r3',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    const v0 = await adapter.saveRoom(room, -1);
    expect(v0.version).toBe(0);

    const v1 = await adapter.saveRoom({ ...v0, currentRound: 1 }, v0.version);
    expect(v1.version).toBe(1);
    expect(v1.currentRound).toBe(1);
  });

  it('saveRoom rejects a write with a stale expectedVersion (optimistic locking)', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r4',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    const v0 = await adapter.saveRoom(room, -1);
    await adapter.saveRoom({ ...v0, currentRound: 1 }, v0.version);

    await expect(
      adapter.saveRoom({ ...v0, currentRound: 2 }, v0.version),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it('handles many concurrent CAS writers without losing any update (true Redis atomicity)', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r5',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    await adapter.saveRoom(room, -1);

    async function joinWithRetry(playerId: string) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const current = await adapter.getRoom('r5');
        if (!current) throw new Error('room disappeared');
        const updated = {
          ...current,
          players: {
            ...current.players,
            [playerId]: PlayerFactory.create({
              telegramId: playerId,
              nickname: playerId,
              joinedAt: 1000,
            }),
          },
        };
        try {
          await adapter.saveRoom(updated, current.version);
          return;
        } catch (err) {
          if (err instanceof ConcurrentModificationError) continue;
          throw err;
        }
      }
      throw new Error(`joinWithRetry exhausted retries for ${playerId}`);
    }

    const playerIds = Array.from({ length: 10 }, (_, i) => `p${i}`);
    await Promise.all(playerIds.map(joinWithRetry));

    const final = await adapter.getRoom('r5');
    expect(Object.keys(final!.players).sort()).toEqual([...playerIds].sort());
  });

  it('deleteRoom removes the room and its active-room membership', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const room = RoomFactory.create({
      id: 'r6',
      hostTelegramId: 'host1',
      chatId: 'chat1',
      now: 1000,
    });
    await adapter.saveRoom(room, -1);
    expect(await adapter.listActiveRoomIds()).toContain('r6');

    await adapter.deleteRoom('r6');
    expect(await adapter.getRoom('r6')).toBeNull();
    expect(await adapter.listActiveRoomIds()).not.toContain('r6');
  });

  it('listActiveRoomIds tracks multiple rooms', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    for (const id of ['ra', 'rb', 'rc']) {
      const room = RoomFactory.create({
        id,
        hostTelegramId: 'host1',
        chatId: 'chat1',
        now: 1000,
      });
      await adapter.saveRoom(room, -1);
    }
    const active = await adapter.listActiveRoomIds();
    expect(active.sort()).toEqual(['ra', 'rb', 'rc']);
  });

  it('player session get/set/clear round-trips correctly', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    expect(await adapter.getPlayerSession('user1')).toBeNull();

    await adapter.setPlayerSession('user1', 'room-x');
    expect(await adapter.getPlayerSession('user1')).toBe('room-x');

    await adapter.clearPlayerSession('user1');
    expect(await adapter.getPlayerSession('user1')).toBeNull();
  });

  it('appendEvents and getEvents round-trip a match event log in order', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const events: DomainEvent[] = [
      createEvent(
        {
          type: DomainEventType.ROOM_CREATED,
          roomId: 'r7',
          matchId: 'm1',
          round: 0,
          payload: { hostTelegramId: 'host1' },
        },
        1000,
      ),
      createEvent(
        {
          type: DomainEventType.GAME_STARTED,
          roomId: 'r7',
          matchId: 'm1',
          round: 1,
          payload: { playerCount: 6 },
        },
        1001,
      ),
    ];
    await adapter.appendEvents('m1', events);
    const fetched = await adapter.getEvents('m1');
    expect(fetched).toHaveLength(2);
    expect(fetched[0].type).toBe(DomainEventType.ROOM_CREATED);
    expect(fetched[1].type).toBe(DomainEventType.GAME_STARTED);
  });

  it('getEvents returns an empty array for a match with no logged events', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    expect(await adapter.getEvents('no-such-match')).toEqual([]);
  });

  it('recordActionIdIfNew returns true only the first time, false on duplicate', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const first = await adapter.recordActionIdIfNew('room1', 'action-1', 60);
    const second = await adapter.recordActionIdIfNew('room1', 'action-1', 60);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('recordActionIdIfNew is scoped per-room (same actionId in different rooms is independent)', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    const roomA = await adapter.recordActionIdIfNew('roomA', 'shared-id', 60);
    const roomB = await adapter.recordActionIdIfNew('roomB', 'shared-id', 60);
    expect(roomA).toBe(true);
    expect(roomB).toBe(true);
  });

  it('recordActionIdIfNew entries expire after their TTL', async () => {
    if (!redisAvailable) return;
    const adapter = new RedisStorageAdapter(redis);
    await adapter.recordActionIdIfNew('room1', 'expiring-action', 1);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const afterExpiry = await adapter.recordActionIdIfNew('room1', 'expiring-action', 60);
    expect(afterExpiry).toBe(true);
  });
});
