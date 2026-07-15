import { Redis } from 'ioredis';
import { StoragePort } from '../../engine/ports/StoragePort';
import { RoomState } from '../../engine/domain/Room';
import { DomainEvent } from '../../engine/events/DomainEvent';
import { ConcurrentModificationError } from '../../engine/errors/DomainError';
import { RedisKeys } from './RedisKeys';
import { SAVE_ROOM_CAS_SCRIPT } from './luaScripts';

/**
 * Production StoragePort implementation backed by Redis (SRS section 9).
 * This is the ONLY module in the codebase that imports ioredis directly --
 * every other engine/service file depends solely on the StoragePort
 * interface, so this class is the single Hexagonal-Architecture "adapter"
 * plugging Redis into the engine.
 *
 * Concurrency: `saveRoom` uses a Lua script (see luaScripts.ts) for a truly
 * atomic compare-and-swap, rather than ioredis's WATCH/MULTI, since a Lua
 * script has no round-trip race window and works correctly if this bot is
 * ever horizontally scaled to multiple processes sharing one Redis instance.
 */
export class RedisStorageAdapter implements StoragePort {
  private readonly saveRoomScriptSha: Promise<string>;

  constructor(private readonly redis: Redis) {
    this.saveRoomScriptSha = this.redis.script(
      'LOAD',
      SAVE_ROOM_CAS_SCRIPT,
    ) as Promise<string>;
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    const raw = await this.redis.get(RedisKeys.room(roomId));
    if (!raw) return null;
    return JSON.parse(raw) as RoomState;
  }

  async saveRoom(room: RoomState, expectedVersion: number): Promise<RoomState> {
    const toSave: RoomState = { ...room, version: expectedVersion + 1 };
    const serialized = JSON.stringify(toSave);
    const sha = await this.saveRoomScriptSha;

    let raw: unknown;
    try {
      raw = await this.redis.evalsha(
        sha,
        1,
        RedisKeys.room(room.id),
        String(expectedVersion),
        serialized,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('NOSCRIPT')) {
        const freshSha = (await this.redis.script(
          'LOAD',
          SAVE_ROOM_CAS_SCRIPT,
        )) as string;
        raw = await this.redis.evalsha(
          freshSha,
          1,
          RedisKeys.room(room.id),
          String(expectedVersion),
          serialized,
        );
      } else {
        throw err;
      }
    }

    const [success, resultJson] = raw as [number, string | false];

    if (success !== 1 || resultJson === false) {
      throw new ConcurrentModificationError(room.id);
    }

    if (expectedVersion === -1) {
      await this.redis.sadd(RedisKeys.activeRooms(), room.id);
    }

    return JSON.parse(resultJson) as RoomState;
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.redis.del(RedisKeys.room(roomId));
    await this.redis.srem(RedisKeys.activeRooms(), roomId);
    await this.redis.del(RedisKeys.timerDeadline(roomId));
  }

  async listActiveRoomIds(): Promise<string[]> {
    return this.redis.smembers(RedisKeys.activeRooms());
  }

  async getPlayerSession(telegramId: string): Promise<string | null> {
    return this.redis.get(RedisKeys.playerSession(telegramId));
  }

  async setPlayerSession(telegramId: string, roomId: string): Promise<void> {
    await this.redis.set(RedisKeys.playerSession(telegramId), roomId);
  }

  async clearPlayerSession(telegramId: string): Promise<void> {
    await this.redis.del(RedisKeys.playerSession(telegramId));
  }

  async appendEvents(matchId: string, events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    const serialized = events.map((e) => JSON.stringify(e));
    await this.redis.rpush(RedisKeys.matchLogs(matchId), ...serialized);
  }

  async getEvents(matchId: string): Promise<DomainEvent[]> {
    const raw = await this.redis.lrange(RedisKeys.matchLogs(matchId), 0, -1);
    return raw.map((r) => JSON.parse(r) as DomainEvent);
  }

  async recordActionIdIfNew(
    roomId: string,
    actionId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      RedisKeys.actionDedup(roomId, actionId),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  async setTimerDeadline(roomId: string, deadlineEpochMs: number): Promise<void> {
    await this.redis.set(RedisKeys.timerDeadline(roomId), String(deadlineEpochMs));
  }

  async getTimerDeadline(roomId: string): Promise<number | null> {
    const raw = await this.redis.get(RedisKeys.timerDeadline(roomId));
    return raw === null ? null : Number(raw);
  }

  async clearTimerDeadline(roomId: string): Promise<void> {
    await this.redis.del(RedisKeys.timerDeadline(roomId));
  }

  async markDmReachable(telegramId: string): Promise<void> {
    await this.redis.set(RedisKeys.dmReachable(telegramId), '1');
  }

  async isDmReachable(telegramId: string): Promise<boolean> {
    const raw = await this.redis.get(RedisKeys.dmReachable(telegramId));
    return raw === '1';
  }
}
