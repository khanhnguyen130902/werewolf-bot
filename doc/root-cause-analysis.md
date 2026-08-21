# Root-Cause Analysis Records

This record captures the material defects and race risks found during the audit. Severity reflects the pre-fix impact in the current bot architecture, not the residual risk after remediation.

## BUG-001 — Cross-game player-session race

| Field | Record |
|---|---|
| Bug ID | BUG-001 |
| Severity | Critical |
| Area | Room membership/session isolation; `RoomService`, storage adapters |
| Scenario | Two rooms concurrently accept the same Telegram user before either room observes the other membership. |
| Expected | A player can be reserved by at most one active room/match. One concurrent join succeeds; the other is rejected deterministically. |
| Actual | A non-atomic read-then-write path could allow both joins under interleaving requests. |
| Root cause | Session ownership was not claimed as a single conditional storage operation. |
| Fix | Added `StoragePort.reservePlayerSession`; Redis uses `SET ... NX` and in-memory storage mirrors first-writer-wins semantics. `RoomService` rejects the losing join. |
| Regression | `RedisStorageAdapter.test.ts`, `RoomServiceJoinPrecedence.test.ts`, `ConcurrencyAudit.test.ts`, and full regression. |

## BUG-002 — Stale split-resolution commit

| Field | Record |
|---|---|
| Bug ID | BUG-002 |
| Severity | High |
| Area | Night/execution split APIs; `NightActionService`, `DayService`, `GameOrchestrator` |
| Scenario | `prepare...Resolution` snapshots state, an unrelated mutation commits, then an old async finalizer applies a death or phase transition. |
| Expected | A finalizer based on an old snapshot must not mutate newer room state. |
| Actual | Without freshness validation, a delayed Hunter/revenge or night finalizer could overwrite newer state or duplicate resolution. |
| Root cause | The async gap separated observation from commit without a version check. |
| Fix | Carry `roomVersion` from prepare to finalize and reject mismatches with `STALE_RESOLUTION`. Commit paths also guard phase/action identity. |
| Regression | `ConcurrencyAudit.test.ts`, `NightActionService.test.ts` split-resolution freshness tests, `DayService.test.ts`, and `GameOrchestrator.test.ts`. |

## BUG-003 — Stale night/Witch timer mutation

| Field | Record |
|---|---|
| Bug ID | BUG-003 |
| Severity | High |
| Area | `GameFlowController` timers and phase lifecycle |
| Scenario | A timer from an earlier night or Witch sub-phase fires after the room has advanced, restarted, or entered another generation. |
| Expected | Stale callbacks are no-ops and cannot submit actions, close a new phase, or send misleading prompts. |
| Actual | Timer callbacks could act on current room state after their originating phase had become obsolete. |
| Root cause | Timer identity/generation was not checked at callback execution time. |
| Fix | Added generation/phase freshness guards before timer-driven mutation and recovery. |
| Regression | `GameFlowController.test.ts`, `RoomTimerService.test.ts`, `GameOrchestrator.test.ts`, and full regression. |

## BUG-004 — Error objects serialized as empty structures

| Field | Record |
|---|---|
| Bug ID | BUG-004 |
| Severity | Medium |
| Area | Error logging and operational diagnosis; `GameFlowController` |
| Scenario | A caught `Error` is passed directly into structured logging/JSON serialization. |
| Expected | Logs preserve error name, message and stack/context so an operator can identify the failed operation. |
| Actual | Native `Error` enumerable properties are often empty, producing `{}` and hiding root cause. |
| Root cause | Logging assumed arbitrary error objects serialize useful fields automatically. |
| Fix | Added `serializeError()` and structured logging fields for error name/message/stack and operation context. |
| Regression | `GameFlowController.test.ts` failure/recovery assertions and log review. |

## BUG-005 — Malformed or oversized callback payload acceptance

| Field | Record |
|---|---|
| Bug ID | BUG-005 |
| Severity | Medium |
| Area | Telegram callback parser and action callback handler |
| Scenario | Empty fields, missing segments, separator-like target content, legacy payloads, or payloads over Telegram's 64-byte contract reach parsing/dispatch. |
| Expected | Malformed or oversized input is rejected without inventing scope/target values; valid legacy and ballot-scoped payloads remain compatible. |
| Actual | Parser accepted some malformed forms and did not enforce the byte limit at the inbound boundary. |
| Root cause | Validation focused on the producer format but did not fully defend the consumer boundary. |
| Fix | Added empty-field validation, target normalization, ballot identity preservation, and UTF-8 byte-length enforcement (`Buffer.byteLength <= 64`). Unknown action types remain safely ignored by dispatch. |
| Regression | `KeyboardsSecurity.test.ts` (including oversized payload), `ballotToken.test.ts`, and `actionCallbackHandler.test.ts`. |

## BUG-006 — Player capacity not hard-bounded

| Field | Record |
|---|---|
| Bug ID | BUG-006 |
| Severity | Medium |
| Area | Room creation/join/start and role distribution |
| Scenario | A caller supplies settings or joins that exceed the supported engine/test envelope, causing role plans and timers to operate outside validated bounds. |
| Expected | Supported capacity is hard-bounded to 3–15 players, with explicit rejection/clamping behavior and no hidden overflow. |
| Actual | Limits were not consistently enforced at all entry points. |
| Root cause | Capacity was treated as a configurable setting without a system-level maximum. |
| Fix | Centralized `MIN_SUPPORTED_PLAYERS`/`MAX_SUPPORTED_PLAYERS`, clamped room settings, and enforced capacity in `Room`, `RoomService`, `GameService`, and distribution strategy. |
| Regression | `PlayerCountMatrix.test.ts`, `RoomService.test.ts`, `GameService.test.ts`, `RoleDistributionStrategy.test.ts`, `RoleDistributionProperty.test.ts`. |

## BUG-007 — Partial mute cleanup lost failed unmute targets

| Field | Record |
|---|---|
| Bug ID | BUG-007 |
| Severity | Medium |
| Area | Telegram mute/unmute lifecycle; `MuteService` |
| Scenario | Unmute is attempted for multiple users and one or more Telegram calls fail transiently. |
| Expected | Successfully unmuted users are removed; failed targets remain tracked for retry and are not silently forgotten. |
| Actual | A bulk cleanup path could discard the complete tracking set even when only part of the operation succeeded. |
| Root cause | Cleanup treated the batch as all-or-nothing without durable per-user retention. |
| Fix | Redis tracking now retains only users whose unmute failed, while successful targets are removed. |
| Regression | `MuteService.test.ts` partial-unmute failure retention test and full regression. |

## BUG-008 — DAY `/vote` path was incomplete for the intended gameplay contract

| Field | Record |
|---|---|
| Bug ID | BUG-008 |
| Severity | Medium |
| Area | Day phase command/state transition |
| Scenario | A player invokes `/vote` while the room is in `DAY` as an early skip of the discussion opening. |
| Expected | The command starts the daytime ballot without requiring an invalid intermediate transition. |
| Actual | The original transition path did not consistently support `DAY → VOTING`, causing an apparent no-response/invalid-phase behavior. |
| Root cause | The state machine and day application service did not share the early-skip contract. |
| Fix | Added `DAY → VOTING`; `DayService.startVoting` accepts `DAY` and `DISCUSSION` and creates a fresh ballot. |
| Regression | `GameStateMachine.test.ts`, `DayService.test.ts`, command tests, and full E2E regression. |

## BUG-009 — Night resolution could be replayed after phase completion

| Field | Record |
|---|---|
| Bug ID | BUG-009 |
| Severity | High |
| Area | `NightActionService` resolution lifecycle |
| Scenario | A duplicate callback, timer, or retry calls night finalization after the room has already left the night phase. |
| Expected | The second resolution is rejected or safely ignored and cannot append duplicate deaths/events. |
| Actual | Replay could reach resolution logic after the phase had already ended. |
| Root cause | Finalization lacked a strict current-phase guard in addition to action deduplication. |
| Fix | Added explicit NIGHT/FIRST_NIGHT phase validation and terminal/replay guards. |
| Regression | `NightActionService.test.ts`, `DayService.test.ts`, `InvariantAudit.test.ts`, and resolution stress tests. |

## Post-fix conclusion

All listed regressions are passing in the measured suite. No critical/high issue remains open in the tested single-process architecture. Remaining operational risks are documented separately: live Telegram network behavior, Redis outage/failover, process restart with active scheduler jobs, and enforcement of coverage/cleanup thresholds in CI.
