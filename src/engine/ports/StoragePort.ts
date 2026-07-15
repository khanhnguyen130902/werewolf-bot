import { RoomState } from '../domain/Room';
import { DomainEvent } from '../events/DomainEvent';

/**
 * Storage abstraction the Game Engine depends on. The engine NEVER imports
 * ioredis or any Redis-specific type — it only knows this interface. This is
 * what makes "Game Engine độc lập với Telegram" (SRS section 3) achievable
 * in practice: swapping Redis for an in-memory store (tests) or a different
 * database in the future requires writing one new adapter class, zero engine
 * changes.
 *
 * Optimistic locking (Suggestion #1): `saveRoom` takes the `expectedVersion`
 * the caller last read. The adapter must atomically check-and-increment the
 * version, throwing ConcurrentModificationError on mismatch.
 */
export interface StoragePort {
  getRoom(roomId: string): Promise<RoomState | null>;
  /**
   * Persist room state. Implementations MUST perform this atomically
   * (e.g. Redis WATCH/MULTI or a Lua script) and MUST reject the write if
   * the stored version does not equal `expectedVersion`.
   */
  saveRoom(room: RoomState, expectedVersion: number): Promise<RoomState>;
  deleteRoom(roomId: string): Promise<void>;
  listActiveRoomIds(): Promise<string[]>;

  /** Maps a Telegram user id to the room they are currently in (session lookup). */
  getPlayerSession(telegramId: string): Promise<string | null>;
  setPlayerSession(telegramId: string, roomId: string): Promise<void>;
  clearPlayerSession(telegramId: string): Promise<void>;

  /** Append-only event log per match (SRS section 12, Suggestion #11). */
  appendEvents(matchId: string, events: DomainEvent[]): Promise<void>;
  getEvents(matchId: string): Promise<DomainEvent[]>;

  /**
   * Idempotency guard (Suggestion #2): records that `actionId` was processed
   * for `roomId`. Returns false if it was already recorded (i.e. duplicate).
   * Should expire automatically after the round/phase ends to bound memory.
   */
  recordActionIdIfNew(roomId: string, actionId: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Persists the absolute epoch-ms deadline for a room's current timed phase
   * (Suggestion #6: resume after restart). RoomTimerService writes this
   * whenever it schedules a phase timeout, and reads it back on process
   * startup to recompute each active room's remaining time rather than
   * losing track of in-flight countdowns across a bot restart.
   */
  setTimerDeadline(roomId: string, deadlineEpochMs: number): Promise<void>;
  getTimerDeadline(roomId: string): Promise<number | null>;
  clearTimerDeadline(roomId: string): Promise<void>;

  /**
   * Records that a Telegram user has DMed the bot at least once (i.e. sent
   * /start in a private chat), which Telegram requires before the bot can
   * push any message to that user. Confirmed UX rule: joining a room
   * requires this to be true first, so the bot can guarantee it can deliver
   * private role/action messages once the match starts.
   */
  markDmReachable(telegramId: string): Promise<void>;
  isDmReachable(telegramId: string): Promise<boolean>;
}
