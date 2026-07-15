/**
 * Central Redis key-naming schema (SRS section 9: `room:{id}`, `player:{id}`,
 * `match:{id}`, `logs:{matchId}`, `timer:{roomId}`, `session:{telegramId}`).
 *
 * Keeping every key pattern in one module -- rather than inline template
 * strings scattered across RedisStorageAdapter -- means a future key-schema
 * change (e.g. adding a namespace prefix for multi-tenant deployments) is a
 * one-file edit, and it's immediately obvious from reading this file exactly
 * what data lives in Redis and how it's organized.
 */
export const RedisKeys = {
  /** Full room state (JSON-serialized RoomState), including players. */
  room: (roomId: string): string => `room:${roomId}`,

  /** Set of all room ids currently considered "active" (not yet closed). */
  activeRooms: (): string => 'rooms:active',

  /** Maps a Telegram user id -> the room id they are currently in. */
  playerSession: (telegramId: string): string => `session:${telegramId}`,

  /** Append-only list of JSON-serialized DomainEvents for one match. */
  matchLogs: (matchId: string): string => `logs:${matchId}`,

  /**
   * Idempotency marker for a single (roomId, actionId) pair (Suggestion #2).
   * Stored with a TTL so it self-expires instead of growing Redis memory
   * unboundedly across a long-running bot process.
   */
  actionDedup: (roomId: string, actionId: string): string =>
    `action-dedup:${roomId}:${actionId}`,

  /**
   * Scheduled-timer bookkeeping for a room (Suggestion #6: resume after
   * restart). Stores the absolute epoch-ms deadline for the room's current
   * timed phase, so a restarted process can compute "how much time is left"
   * instead of losing track of an in-flight countdown.
   */
  timerDeadline: (roomId: string): string => `timer:${roomId}`,

  /** Marks that a Telegram user has DMed the bot at least once (see
   * StoragePort.markDmReachable doc for the UX rule this enforces). */
  dmReachable: (telegramId: string): string => `dm-reachable:${telegramId}`,
} as const;
