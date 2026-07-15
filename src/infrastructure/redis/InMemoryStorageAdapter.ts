import { StoragePort } from '../../engine/ports/StoragePort';
import { RoomState } from '../../engine/domain/Room';
import { DomainEvent } from '../../engine/events/DomainEvent';
import { ConcurrentModificationError } from '../../engine/errors/DomainError';

/**
 * In-memory implementation of StoragePort. Used for unit/integration tests
 * so the engine test suite never needs a real Redis instance. Mirrors the
 * concurrency contract (version check) that RedisStorageAdapter must honor,
 * so tests written against this adapter also validate the optimistic-locking
 * behavior expected of the real adapter.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private rooms = new Map<string, RoomState>();
  private sessions = new Map<string, string>();
  private events = new Map<string, DomainEvent[]>();
  private actionIds = new Set<string>();
  private timerDeadlines = new Map<string, number>();
  private dmReachableUsers = new Set<string>();

  /**
   * @param defaultDmReachable When true (the default), `isDmReachable`
   *   returns true for ANY telegramId that hasn't been explicitly tracked
   *   yet, rather than requiring every test to call `markDmReachable` for
   *   every player it creates. This mirrors how most unit/integration tests
   *   care about game logic, not the DM-gating UX rule specifically; tests
   *   that DO want to exercise the DM-gating behavior should construct with
   *   `new InMemoryStorageAdapter(false)` and call `markDmReachable`
   *   explicitly for the players that should pass the check.
   */
  constructor(private readonly defaultDmReachable: boolean = true) {}

  /** Deep clone via JSON round-trip — avoids relying on the structuredClone
   * global, keeping this adapter compatible with older Node/runtime targets. */
  private clone(room: RoomState): RoomState {
    return JSON.parse(JSON.stringify(room));
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    const room = this.rooms.get(roomId);
    return room ? this.clone(room) : null;
  }

  async saveRoom(room: RoomState, expectedVersion: number): Promise<RoomState> {
    const existing = this.rooms.get(room.id);
    if (existing && existing.version !== expectedVersion) {
      throw new ConcurrentModificationError(room.id);
    }
    const toSave: RoomState = { ...room, version: expectedVersion + 1 };
    this.rooms.set(room.id, this.clone(toSave));
    return this.clone(toSave);
  }

  async deleteRoom(roomId: string): Promise<void> {
    this.rooms.delete(roomId);
    this.timerDeadlines.delete(roomId);
  }

  async listActiveRoomIds(): Promise<string[]> {
    return [...this.rooms.keys()];
  }

  async getPlayerSession(telegramId: string): Promise<string | null> {
    return this.sessions.get(telegramId) ?? null;
  }

  async setPlayerSession(telegramId: string, roomId: string): Promise<void> {
    this.sessions.set(telegramId, roomId);
  }

  async clearPlayerSession(telegramId: string): Promise<void> {
    this.sessions.delete(telegramId);
  }

  async appendEvents(matchId: string, events: DomainEvent[]): Promise<void> {
    const existing = this.events.get(matchId) ?? [];
    this.events.set(matchId, [...existing, ...events]);
  }

  async getEvents(matchId: string): Promise<DomainEvent[]> {
    return this.events.get(matchId) ?? [];
  }

  async recordActionIdIfNew(
    roomId: string,
    actionId: string,
    _ttlSeconds: number,
  ): Promise<boolean> {
    const key = `${roomId}:${actionId}`;
    if (this.actionIds.has(key)) {
      return false;
    }
    this.actionIds.add(key);
    return true;
  }

  async setTimerDeadline(roomId: string, deadlineEpochMs: number): Promise<void> {
    this.timerDeadlines.set(roomId, deadlineEpochMs);
  }

  async getTimerDeadline(roomId: string): Promise<number | null> {
    return this.timerDeadlines.get(roomId) ?? null;
  }

  async clearTimerDeadline(roomId: string): Promise<void> {
    this.timerDeadlines.delete(roomId);
  }

  async markDmReachable(telegramId: string): Promise<void> {
    this.dmReachableUsers.add(telegramId);
  }

  async isDmReachable(telegramId: string): Promise<boolean> {
    if (this.dmReachableUsers.has(telegramId)) return true;
    // If this user was never explicitly marked either way, fall back to the
    // constructor default rather than hard-coding `false` -- see the
    // constructor doc for why tests generally want `true` here.
    return this.defaultDmReachable;
  }
}
