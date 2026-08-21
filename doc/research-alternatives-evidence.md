# Evidence-based research notes

## Telegram Bot API
Source: https://core.telegram.org/bots/api

The official Bot API defines `InlineKeyboardButton.callback_data` as a String with a size of **1–64 bytes**. This is a byte limit, so multibyte UTF-8 content consumes more than one byte per visible character. The implementation now validates incoming callback payload size using `Buffer.byteLength(data, 'utf8') <= 64` before parsing.

The official API also exposes `answerCallbackQuery`; callback handlers should acknowledge callback queries so the client-side progress indicator does not remain pending. Existing callback tests verify acknowledgement/confirmation behavior for vote and night actions.

## Redis SET NX
Source: https://redis.io/docs/latest/commands/set/

Redis `SET key value NX` sets the key only when it does not already exist. The command has O(1) complexity and can combine `NX` with an expiration option such as `EX` or `PX`. This is an appropriate primitive for an atomic first-writer-wins player-session reservation. The Redis adapter uses this primitive for cross-game session claims; the in-memory adapter mirrors the same NX semantics for deterministic tests.

## Redis transactions / optimistic locking
Source: https://redis.io/docs/latest/develop/using-commands/transactions/

Redis transactions execute queued commands sequentially and isolate the transaction from interleaving commands. `WATCH` provides optimistic locking/check-and-set behavior: if a watched key changes before `EXEC`, the transaction aborts. Redis does not provide rollback for already executed transaction operations. Therefore the current room-version freshness guard is a proportionate optimistic-concurrency solution for split resolution: stale finalizers are rejected instead of introducing a distributed lock and its lifecycle/lease risks.

## Recommendations

1. Keep the Telegram callback payload bounded at the parser boundary; do not rely only on outbound keyboard construction because malicious or stale inbound callbacks can bypass the builder.
2. Keep `SET NX` for cross-game session claims; include a TTL/cleanup policy for abandoned claims and preserve an explicit release path on leave/game termination.
3. Keep room-version/actionId freshness checks for single-room state mutations. A distributed lock is not justified by current evidence because the engine already rejects stale snapshots and deduplicates action IDs. Revisit only if deployment becomes multi-process with non-serialized room mutations or if contention metrics show repeated CAS conflicts.
4. Keep action idempotency/deduplication at the domain boundary. Retries from Telegram or schedulers should produce either the original result or a safe no-op, not a second mutation.
5. Research scope limitation: official documentation validates the primitives and constraints, but no production Redis failure-injection run was performed in this sandbox; Redis adapter behavior is validated by unit tests and application-level contract tests.

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
[2]: https://redis.io/docs/latest/commands/set/ "Redis SET command"
[3]: https://redis.io/docs/latest/develop/using-commands/transactions/ "Redis Transactions"
