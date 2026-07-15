/**
 * Atomic compare-and-swap save for RoomState (Suggestion #1: optimistic
 * locking). A Lua script is used instead of WATCH/MULTI because ioredis's
 * WATCH/MULTI requires a dedicated connection per transaction and is
 * inherently racier under high concurrency (the round-trip between WATCH and
 * EXEC leaves a window where another client's write can slip in and be
 * silently missed if not handled carefully). A Lua script executes as a
 * single atomic operation on the Redis server itself -- no race window is
 * possible, and it works correctly even when many bot instances share one
 * Redis (a real deployment concern once this bot scales beyond one process).
 *
 * KEYS[1] = the room's Redis key (e.g. "room:abc123")
 * ARGV[1] = expected current version (as a string; -1 means "must not exist yet")
 * ARGV[2] = new room JSON (with version already incremented by the caller)
 *
 * Returns:
 *   1 and the stored JSON on success
 *   0 and the CURRENT stored JSON on version mismatch (so the caller can
 *     decide whether to retry, without a second round-trip to fetch it)
 */
export const SAVE_ROOM_CAS_SCRIPT = `
local key = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local newValue = ARGV[2]

local current = redis.call('GET', key)

if expectedVersion == -1 then
  -- Caller expects the key to not exist yet (first-ever save of a new room).
  if current then
    return {0, current}
  end
  redis.call('SET', key, newValue)
  return {1, newValue}
end

if not current then
  -- Caller expected an existing room but it's gone (e.g. deleted/expired).
  return {0, false}
end

local currentVersion = cjson.decode(current).version

if currentVersion ~= expectedVersion then
  return {0, current}
end

redis.call('SET', key, newValue)
return {1, newValue}
`;
