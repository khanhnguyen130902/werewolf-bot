# Werewolf Telegram Bot — Master Audit Final Report

**Ngày audit:** 21/08/2026

**Branch:** `feature/silent-mage`

**Phạm vi:** Full system audit, game-rule verification, Silent Mage integration, race-condition hardening, E2E, concurrency, stress, persistence/recovery, security, observability và performance.

**Tác giả:** Manus AI

> **Kết luận ngắn:** Branch đạt trạng thái **COMPLETED cho phạm vi engine/application-level đã kiểm chứng**, với build pass, 49/49 Jest suites pass, 354/354 tests pass, 200/200 full-flow E2E pass và 200/200 adversarial E2E pass. Không còn Critical/High issue chưa được xử lý trong phạm vi single-process deterministic test environment. Tuy nhiên, production-wide rollout vẫn cần controlled canary với Telegram API thật, Redis/BullMQ restart/failover thật và nhiều-process contention, vì các yếu tố này chưa được mô phỏng đầy đủ trong sandbox.

---

## 1. Executive Summary

### Current health

Hệ thống hiện có state machine rõ ràng, domain state nằm trong `RoomState`, role actions được kiểm tra server-side, resolution order deterministic, action replay được chặn, và các asynchronous finalizer/timer có freshness guard. Silent Mage đã được tích hợp vào role registry, distribution contract, night resolver, discussion silence gate, speech-death handling và bot simulation.

Các regression gate cuối cùng đều pass. Build TypeScript pass. Full Jest regression đạt 49 suites và 354 tests. Coverage hiện tại là 78.38% statements, 63.31% branches, 78.05% functions và 80.51% lines. Đợt full-flow gồm 200 runs, trong đó 100 Seer baseline và 100 Silent Mage, đạt 200/200 `GAME_OVER`; đợt adversarial gồm 10 scenarios × 20 runs đạt 200/200.

### Stability and fixes

Audit đã phát hiện và xử lý các vấn đề material: cross-game session race; stale split-resolution; stale night/Witch timer; logging Error thành `{}`; callback payload malformed/oversized; capacity không bounded; partial unmute làm mất retry target; DAY `/vote` path chưa hoàn chỉnh; và night resolution replay sau phase end. Mỗi nhóm đều có regression test tương ứng.

### Major risks remaining

Rủi ro còn lại chủ yếu nằm ở **environment boundary**, không phải lỗi logic đã tái hiện: Telegram API thật và rate limit/permissions; Redis outage/failover/serialization trong điều kiện network lỗi; BullMQ worker restart giữa deadline; deployment nhiều process cùng mutate một room; và việc Jest dùng `--forceExit` có thể che một số cleanup defect nếu CI không kiểm tra open handles riêng.

### Architecture improvements

Các thay đổi được thực hiện theo evidence và risk, không thay architecture chỉ vì best practice. Hệ thống dùng room-version optimistic concurrency cho split resolution, atomic Redis `SET NX` cho session claim, `actionId`/ballot identity cho idempotency, generation guard cho timer, safe Telegram delivery tách khỏi authoritative game state, và structured error serialization. Theo tài liệu Telegram Bot API, `InlineKeyboardButton.callback_data` chỉ được phép từ 1 đến 64 bytes [1]; parser inbound nay cũng enforce byte limit thay vì chỉ tin producer. Redis `SET NX` chỉ set key khi key chưa tồn tại [2], nên phù hợp với first-writer-wins session reservation.

---

## 2. System Audit

| Area | Status | Findings | Severity | Action |
|---|---|---|---|---|
| Entry point and wiring | PASS | `src/index.ts` wires Telegram, storage, scheduler, services and event bus. | Low | Regression-tested; no architectural rewrite. |
| State authority | PASS with boundary risk | `RoomState` is the authoritative domain object; persistence writes are versioned. Timers and Telegram messages do not directly own game truth. | Medium residual in multi-process deployment | Keep service/domain mutation boundary; add distributed room serialization only if deployment becomes multi-process. |
| State machine | PASS | Legal/illegal transitions and terminal `GAME_OVER` behavior are tested. Includes `DAY → VOTING` and Silent Mage `DISCUSSION → CHECK_WIN → ...`. | None open | Keep transition assertions and regression tests. |
| Game services | PASS | `GameService`, `DayService`, `NightActionService` validate phase, player, role, target, action identity and freshness. | None open in tested scope | Continue using service-level contracts as mutation boundary. |
| Role registry/distribution | PASS | Seven supported roles are registered and distribution is bounded to 3–15 players. Silent Mage is explicit and does not silently auto-enable in the default 8-player plan. | None open | Preserve explicit-role policy. |
| Resolution engine | PASS | Protection/save/poison/silence order is deterministic and independent of callback arrival order. | None open | Keep ordered `nightActionOrder` and matrix tests. |
| Persistence | PASS with operational gap | In-memory and Redis adapters support room state, events, version and NX session claim. | Medium residual | Run Redis outage, reconnect and failover tests in staging. |
| Scheduler/timers | PASS with restart gap | Timer deadlines, cancellation and generation guards are covered. | Medium residual | Validate BullMQ worker restart and overdue-room recovery in staging. |
| Telegram integration | PASS at application boundary | Callback acknowledgement, safe sending, malformed payload rejection and API failure isolation are covered with mocks. | Medium residual | Controlled Telegram canary for 429, 5xx, permission and stale-message behavior. |
| Error handling | PASS | Errors are serialized with context; delivery failures no longer block domain flow. | Low | Add CI check for unhandled rejections and open handles. |
| Observability | PASS/partial | Structured logging, event correlation, telemetry and serialized errors exist. | Medium residual | Add production dashboard/alerts for stale callback, timer, duplicate action and delivery failure rates. |
| Security/input validation | PASS | Server-side user/game/phase/role/target/alive checks and callback byte/shape validation exist. | Low | Keep fuzz/adversarial callback tests. |
| Performance | PASS for current envelope | 100-round bottest and 200-round E2E complete within low millisecond application-level times. | Low | Rebenchmark with production Redis/BullMQ/Telegram mocks under CI. |

---

## 3. Game Rule Audit

The following table records the implemented and tested contract. “PASS” means the behavior is proven by the current deterministic application-level suite; it does not claim that a live Telegram deployment has been tested under every network condition.

| Rule | Expected | Actual | Status | Fix/Regression |
|---|---|---|---|---|
| Capacity | Match starts only within supported 3–15 player envelope. | Room, services and distribution strategy enforce/clamp the hard envelope. | PASS | `PlayerCountMatrix`, `RoomService`, `GameService`, distribution tests. |
| Start condition | Host starts only when minimum player count and role plan are valid. | Invalid count/role capacity is rejected; valid 3-player start is supported. | PASS | `GameService.test.ts`, `RoleDistributionStrategy.test.ts`. |
| Night action validation | Only living players with the correct role can act in NIGHT/FIRST_NIGHT. | Phase, role, target and duplicate action checks are server-side. | PASS | `NightActionService.test.ts`, role acceptance matrix. |
| Wolf kill | Multiple wolves must agree on one valid target; Skip/no consensus causes no kill. | Consensus, dead target and mixed Skip cases are deterministic. | PASS | `NightResolver.test.ts`, `ResolutionOrderMatrix.test.ts`. |
| Bodyguard protection | Protection follows self/consecutive-target settings and resolves before final deaths. | Settings are enforced and protection interacts correctly with wolf kill/Witch save. | PASS | `Roles.test.ts`, `NightActionService.test.ts`, `NightResolver.test.ts`. |
| Witch save/poison | Potions are limited; save/poison behavior follows dual-potion setting and target validation. | Used flags persist; save and poison can be tested independently and together under default setting. | PASS | Witch role, service and resolver matrix tests. |
| Seer information | Seer receives accurate result, privately, with dead-player and repeated-target checks. | Result remains available even if Seer dies during same night; no information leakage in BotPolicy. | PASS | `NightResolver.test.ts`, `BotPolicy.test.ts`, role tests. |
| Hunter death effect | Hunter revenge is triggered only for configured causes, once, with no revenge chain from a revenge shot. | DeathQueue and split prompt/finalize preserve this contract. | PASS | `DeathQueue.test.ts`, orchestrator and interaction tests. |
| Silent Mage silence | Mage targets living non-self player, can repeat target, silence is resolved after Witch poison, and target cannot speak in the active discussion cycle. | Implemented and covered through role, resolver, DayService, BotPolicy and E2E tests. | PASS | Silent Mage test family and 400 case-runs. |
| Voting | Living players vote at most once per ballot; dead/wrong-phase/stale callbacks are rejected. | `ballotId` and action deduplication prevent replay and stale mutation. | PASS | `VoteResolver`, `DayService`, callback security and E2E tests. |
| Tied vote | Tie or abstention leading at the highest tally causes no execution. | Confirmed across 2-way, 3-way, Skip and abstention cases. | PASS | `VoteResolver.test.ts`. |
| Win condition | Village wins when all wolves are dead; wolves win when wolves are equal to or exceed village. | `CHECK_WIN` is evaluated after resolution and terminal state cannot reopen. | PASS | `WinConditionChecker`, `GameStateMachine`, invariant tests. |
| Day `/vote` | `/vote` in DAY skips to daytime VOTING; discussion can also enter VOTING according to product decision. | `DAY → VOTING` and `DISCUSSION → VOTING` create a fresh ballot. | PASS | `DayService.test.ts`, `GameStateMachine.test.ts`. |

---

## 4. Role Audit

| Role | Covered | Issues before fix | Fix | Regression |
|---|---|---|---|---|
| Villager | Yes | No special night action; needed defensive validation. | Safe no-op role metadata and alive/vote checks. | `Roles`, `AllRolesAcceptance`, full regression. |
| Werewolf | Yes | Consensus and duplicate/replay behavior required explicit verification. | Valid target, multiple-wolf consensus, action identity and phase guards. | `NightResolver`, `NightActionService`, E2E/stress. |
| Seer | Yes | Same-night death and private information were high-risk contract points. | Preserve submitted result before death; keep inspection knowledge private to the Seer policy. | `NightResolver`, `BotPolicy`, role/E2E tests. |
| Bodyguard | Yes | Consecutive-target/self-protect settings needed explicit enforcement. | Configuration-driven validation and resolution before final death. | `Roles`, `NightActionService`, `NightResolver`. |
| Witch | Yes | Save/poison inventory and dual-potion ordering could produce inconsistent outcomes. | Persist potion flags and deterministic save/poison resolution. | Witch service/resolver and resolution-order matrix. |
| Hunter | Yes | Async death prompt created split-resolution race risk. | DeathQueue split API, freshness guard, no duplicate/revenge-chain behavior. | `DeathQueue`, orchestrator, concurrency tests. |
| Silent Mage | Yes | New role required contracts for silence duration, public announcement, speech violation and target death. | Added `SilentMageRole`, enum metadata, registry/distribution, silence resolver, Silence Gate, speech death and tests. | 100/100 Silent Mage full-flow; 200/200 adversarial combined cases. |

---

## 5. Role Interaction Matrix

| Interaction | Resolution contract | Result |
|---|---|---|
| Werewolf × Bodyguard | Wolf kill is evaluated with protection before final death. | Protected target survives; covered. |
| Werewolf × Witch save | Witch save can prevent the wolf death according to potion state. | Covered, including save + Bodyguard. |
| Werewolf × Witch poison | Poison is independent and can kill a living valid target. | Covered; poison occurs before Silent Mage silence. |
| Werewolf × Seer | Seer inspection result is committed even if Seer dies the same night. | Covered. |
| Werewolf × Hunter | Wolf kill can trigger Hunter revenge according to cause configuration. | Covered with async prompt and chain rules. |
| Werewolf × Silent Mage | Silence action is an independent night effect and does not change wolf target semantics. | Covered. |
| Bodyguard × Witch | Protection and save may both apply; potion state is still consumed according to rule. | Covered. |
| Bodyguard × Hunter | Hunter trigger depends on death cause, not protection metadata alone. | Covered by DeathQueue trigger matrix. |
| Witch × Hunter | Witch poison can be a Hunter trigger when configured. | Covered by death cause and trigger tests. |
| Witch × Silent Mage | Silent Mage runs after Witch poison, so a poisoned/dead target does not retain silence. | Covered by resolution-order and target-death tests. |
| Seer × Silent Mage | Seer information remains private and independent of silence state. | Covered by BotPolicy and resolver tests. |
| Silent Mage × speech | Public announcement activates enforcement; only an alive silenced player in the current cycle can create `SPOKEN_WHILE_SILENCED`. | Covered by Silence Gate and adversarial E2E. |
| Speech death × vote callback | Speech death is resolved through `CHECK_WIN`; stale/current ballot checks determine whether a later vote can proceed. | 20/20 speech-vote race cases pass; no duplicate death. |

The tested default order is `WEREWOLF_VOTE_KILL → BODYGUARD_PROTECT → SEER_INSPECT → WITCH_SAVE → WITCH_POISON → SILENT_MAGE_SILENCE`. This order is configured, persisted and tested for callback-arrival-order independence.

---

## 6. Player Count Matrix

The table below describes the default distribution strategy when no explicit special-role list is supplied. Explicitly enabled special roles can change the plan subject to capacity validation; Silent Mage remains explicit and is not silently auto-enabled by the default 8-player plan.

| Players | Default role distribution | E2E/validation | Result |
|---:|---|---|---|
| 3 | 1 Werewolf, 2 Villagers | Boundary and distribution tests | PASS |
| 4 | 1 Werewolf, 3 Villagers | Distribution tests | PASS |
| 5 | 2 Werewolves, 3 Villagers | Distribution tests | PASS |
| 6 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Witch, 1 Villager | Full service/E2E paths | PASS |
| 7 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 1 Villager | Distribution/property validation | PASS |
| 8 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 2 Villagers | Distribution/property validation | PASS |
| 9 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 3 Villagers | Distribution/property validation | PASS |
| 10 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 4 Villagers | Distribution/property validation | PASS |
| 11 | 2 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 5 Villagers | Distribution/property validation | PASS |
| 12 | 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 5 Villagers | Distribution/property validation | PASS |
| 13 | 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 6 Villagers | Distribution/property validation | PASS |
| 14 | 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 7 Villagers | Distribution/property validation | PASS |
| 15 | 3 Werewolves, 1 Seer, 1 Bodyguard, 1 Hunter, 1 Witch, 8 Villagers | Distribution/property validation | PASS |
| 1–2 | Invalid below minimum | Rejection tests | PASS — rejected |
| 16, 17 and 100 | Invalid above hard maximum | Rejection tests | PASS — rejected |

For an explicit Silent Mage preset at 8+ players, the strategy adds Silent Mage to the default special-role set when capacity permits. Explicit 6-player Silent Mage plans are also validated by `SilentMageDistribution.test.ts`.

---

## 7. E2E Coverage

The current E2E result is application-level: each case creates isolated storage, room, event bus, service graph, state machine, fake scheduler and mock Telegram gateway. It is therefore strong evidence for domain/application behavior, but not proof of live Telegram, Redis network, BullMQ worker or multi-process behavior.

| Scenario | Coverage | Result |
|---|---|---|
| 01. Normal game | Full flow from create to end | PASS |
| 02. Village win | `CHECK_WIN → GAME_OVER` after wolf elimination | PASS |
| 03. Wolf win | Wolf count reaches/exceeds village count | PASS |
| 04. Hunter death | Trigger, async prompt, decline/timeout and revenge chain | PASS |
| 05. Protection | Wolf kill + Bodyguard protection | PASS |
| 06. Witch heal | Wolf kill + Witch save | PASS |
| 07. Witch poison | Independent poison and death cause | PASS |
| 08. Seer investigation | Accurate/private result, same-night death | PASS |
| 09. Silent Mage | Action submit, resolution, announcement, Silence Gate and violation | PASS |
| 10. Multiple wolves | Consensus and disagreement behavior | PASS |
| 11. Multiple concurrent actions | Concurrent votes/finalizers and 8 isolated rooms | PASS |
| 12. Duplicate action | Duplicate `actionId`, duplicate speech and duplicate vote | PASS |
| 13. Stale callback | Old ballot/cycle/callback identity | PASS |
| 14. Dead-player action | Rejected with domain result and no state corruption | PASS |
| 15. Wrong phase action | Rejected by service/state machine | PASS |
| 16. Player leaves | Leave/join/kick and membership validation tested at service level | PASS at service level; no live Telegram E2E |
| 17. Late join | Locked/in-progress room rejects late join | PASS at service level |
| 18. Game ends during action | Speech/vote and terminal callback race | PASS |
| 19. New game after old game | Clean room/match reset and no old state inheritance | PASS |
| 20. Bot restart | Persistence fields and recovery paths audited; process-kill worker restart not executed | RISK ASSESSED, staging follow-up required |

### 200-round E2E evidence

The dedicated Silent Mage run executed **400 independent case-runs**: 200 full-flow runs and 200 adversarial runs. Full-flow results were 200/200 pass, with 100 Seer baseline runs and 100 Silent Mage runs. Adversarial results were 200/200 pass across opening-not-ready, stale cycle, non-silenced speech, dead speaker, duplicate speech, concurrent speech, speech-vote race, stale ballot, terminal speech and callback-after-transition.

---

## 8. Bugs Found

| ID | Severity | Root Cause | Fix | Regression |
|---|---|---|---|---|
| BUG-001 | Critical | Read-then-write session membership race across rooms. | Atomic `reservePlayerSession`; Redis `SET NX`, in-memory NX mirror. | Redis/session/concurrency tests; full regression. |
| BUG-002 | High | Split async finalizer committed without snapshot freshness validation. | `roomVersion` prepare→finalize guard and `STALE_RESOLUTION`. | Night/day split tests; concurrency tests. |
| BUG-003 | High | Timer callback lacked phase/generation validation. | Timer generation/phase freshness guard. | Timer/GameFlowController tests. |
| BUG-004 | Medium | Native `Error` serialized without enumerable message/stack fields. | `serializeError()` and structured error context. | GameFlowController failure tests. |
| BUG-005 | Medium | Parser assumed producer format and did not fully defend inbound callback boundary. | Empty-field, shape, target normalization and UTF-8 64-byte enforcement. | 17 callback/security tests. |
| BUG-006 | Medium | Capacity setting had no consistent hard system maximum. | Central 3–15 bounds across Room/services/distribution. | Player-count and distribution matrix. |
| BUG-007 | Medium | Bulk unmute cleanup discarded failed targets. | Retain only failed IDs for retry/recovery. | MuteService partial-failure test. |
| BUG-008 | Medium | DAY `/vote` contract was not consistently represented by state machine/service. | Add `DAY → VOTING`, accept DAY and DISCUSSION in `startVoting`. | Day/state-machine/E2E regression. |
| BUG-009 | High | Night finalization could be replayed after phase end. | Strict phase/replay guards plus action deduplication. | Night/day/invariant regression. |

Full RCA records, including scenario, expected/actual, reproduction context, impact and regression mapping, are in `root-cause-analysis.md`.

---

## 9. Race Condition / Concurrency

| Scenario | Root cause | Impact before fix | Fix | Test evidence |
|---|---|---|---|---|
| Same player joins two rooms concurrently | Non-atomic session ownership. | Cross-game identity collision. | Redis/in-memory NX claim. | `RedisStorageAdapter.test.ts`, `ConcurrencyAudit`, join precedence. |
| Two split night finalizers | Async gap between prepare and commit. | Duplicate deaths, stale transition or overwrite. | Room-version freshness check. | Concurrent finalizer tests. |
| Two split execution finalizers | Same as night split. | Duplicate execution/Hunter prompt. | Version + phase commit guard. | DayService/ConcurrencyAudit. |
| Stale timer after phase/game change | Timer outlived originating generation. | Old timer could mutate new phase/game. | Generation and current-phase guard. | GameFlowController/RoomTimer/Orchestrator. |
| Duplicate vote callback | Telegram double click/retry. | Duplicate vote or stale ballot mutation. | Ballot identity and action dedup. | ballot token, callback and DayService tests. |
| Speech event and vote callback together | Both can observe/commit near same state boundary. | Duplicate death or invalid post-terminal vote. | Speech event identity, room version/phase transition and ballot freshness. | 20/20 speech-vote adversarial runs. |
| Duplicate speech delivery | Same event retried. | Multiple death/effect application. | `speechEventId` dedup. | 20/20 duplicate-speech runs. |
| Multiple rooms concurrently | Shared infrastructure/session state. | State leakage between matches. | Room-keyed state and atomic session claim. | 8 concurrent games pass. |

The chosen approach is **optimistic concurrency plus atomic primitives**, not a new distributed lock. Redis documents `WATCH` as optimistic check-and-set and aborts a transaction if a watched key changes before `EXEC` [3]. The current room-version guard provides the same relevant safety property for the split resolution use case without introducing lock lease expiry, owner tokens, deadlock recovery and lock contention. A distributed per-room lock becomes justified only if the deployment changes to multiple workers that can concurrently mutate the same room and version conflicts become frequent.

---

## 10. Timer / Scheduler Audit

The timer contract is one active timer per active room phase. `RoomTimerService` persists an absolute deadline, exposes remaining time, forwards generation metadata and can find overdue rooms. `GameOrchestrator` and `GameFlowController` cancel or replace timers on phase changes. Timer callbacks validate phase and generation before mutating domain state.

Tested behaviors include duplicate scheduling/cancellation, no-op cancellation with no job, persisted deadline, overdue-room discovery, stale night/Witch timer, post-terminal timer, and scheduler port behavior. The invariant is therefore enforced in the tested single-process path:

```text
ONE ROOM → ONE ACTIVE PHASE → ONE VALID TIMER GENERATION
```

Remaining limitation: no process-kill test was executed with a live BullMQ worker while a job was in flight. Staging should restart the worker in NIGHT, DISCUSSION and VOTING, then verify overdue recovery does not duplicate resolution.

---

## 11. Telegram Reliability Audit

The application separates authoritative state from presentation state. A Telegram send/edit/delete failure is logged and isolated through safe delivery wrappers; it does not roll back or block domain resolution. Callback actions are acknowledged and user-facing confirmation is tested for votes and night actions.

The inbound parser now rejects empty action/target fields, malformed shape, invalid normalization and payloads larger than 64 UTF-8 bytes. Telegram's official Bot API specifies `callback_data` as 1–64 bytes [1], so byte-length validation is intentionally used instead of JavaScript character length. Ballot-scoped callbacks preserve ballot identity; legacy non-ballot callbacks remain parseable without inventing a ballot scope.

Covered failures include mocked Telegram error paths and partial unmute failures. Not yet proven against live infrastructure are Telegram 429 backoff/rate limits, 5xx retry policy, permission changes, message-not-found behavior after external deletion, webhook duplicate delivery and API latency distribution. These are canary/staging tasks, not hidden claims of full live coverage.

---

## 12. Persistence / Recovery Audit

Room state, events, current match identity, pending night actions, ballot identity, discussion cycle, silence metadata and deadlines are represented in persisted state. Redis and in-memory adapters implement consistent room version and player-session contracts. The state reset path creates a clean WAITING room and does not inherit old players/effects.

The suite validates Redis adapter behavior, serialization-oriented room persistence, NX session claim, pending action retention and room recreation. It does not simulate a real Redis outage/failover or kill/restart a BullMQ worker process. Therefore recovery readiness is **reasonable for controlled canary but not yet a full production guarantee**.

| Failure mode | Current behavior/evidence | Residual action |
|---|---|---|
| Redis unavailable | Adapter errors are surfaced/logged; application tests cover failure contracts where mocked. | Run outage/reconnect/failover staging test. |
| Redis stale version | Version/freshness checks reject stale commits. | Monitor stale-resolution rate. |
| Process restart | Persisted fields make recovery possible; overdue-room scan exists. | Execute real process-kill recovery at every active phase. |
| Old match state | Fresh match ID and reset fields prevent normal inheritance. | Add live restart/new-match canary assertion. |
| Partial storage write | No transactional outbox was added. | Consider outbox only if telemetry proves event/state divergence. |

---

## 13. Stress Test Result

| Test | Runs/parallelism | Result | Metrics |
|---|---:|---|---|
| Bottest stress | 100 sequential runs | PASS 100/100 | 3,800 events, 600 observations, 100/100 `GAME_OVER`. |
| Concurrent games | 8 rooms concurrently | PASS | No cross-room state leakage; completed in approximately 36 ms in prior stress artifact. |
| Randomized invariant | 25 seeded games | PASS | No dead-player resurrection or terminal-state invariant failure; approximately 355 ms in prior artifact. |
| Role distribution property | 50 seeds × supported counts | PASS | Complete assignments and no invalid special-role duplication. |
| Silent Mage full-flow | 100 Silent Mage + 100 Seer baseline | PASS 200/200 | 10,000 events, 1,900 observations, 200/200 `GAME_OVER`. |
| Silent Mage adversarial | 10 scenarios × 20 | PASS 200/200 | 880 domain events; no duplicate speech death or stale ballot corruption. |

The latest `bottest-stress-100-results.json` reports average elapsed **9.13 ms/run**, maximum **25.58 ms**, minimum **4.92 ms**, total user CPU **1,110 ms**, total system CPU **62 ms**, and maximum RSS delta **14.78 MB**. Memory deltas are process/GC-sensitive; they are not treated as proof of a leak or a stable production RSS budget.

---

## 14. Performance

No blind optimization was performed. Changes were introduced only where correctness and measured test behavior supported them. The following comparison is descriptive because the earlier and later bottest captures were not run under a locked production-equivalent host configuration.

| Metric | Before / earlier capture | After / latest capture | Result |
|---|---:|---:|---|
| Bottest average elapsed | 10.99 ms/run | 9.13 ms/run | Lower in latest capture; not a controlled benchmark claim. |
| Bottest maximum elapsed | 70.64 ms | 25.58 ms | Lower cold/outlier time in latest capture. |
| Bottest pass rate | 100/100 | 100/100 | Preserved. |
| Full Jest regression | 41 suites, 295+ tests at prior checkpoint | 49 suites, 354 tests | Coverage expanded while preserving pass. |
| Full-flow Silent Mage | Not available pre-role | 100/100 Silent Mage; 100/100 Seer baseline | Role addition did not break baseline scenario. |
| Statements coverage | Not captured at initial checkpoint | 78.38% | Improved automation evidence; no threshold enforced. |
| Branch coverage | Not captured at initial checkpoint | 63.31% | Main remaining test-depth gap. |

The dominant remaining performance uncertainty is external I/O: Redis, BullMQ and Telegram latency, not pure domain resolution. Production profiling should measure API calls per phase, queue delay, Redis round-trip latency, stale rejection count and message delivery failures.

---

## 15. Architecture Changes

```text
Before
  ↓
Read-then-write membership, split async commits without complete freshness checks,
legacy phase/timer paths and Telegram delivery coupled to flow progress
  ↓
Problem
  ↓
Cross-game collision, stale mutation, duplicate resolution, apparent no-response,
and external API errors able to interfere with game progression
  ↓
After
  ↓
Atomic session reservation; versioned room commits; phase/generation guards;
ballot/action/speech dedup; safe Telegram delivery; serialized errors;
bounded callback parser; explicit DAY → VOTING path
  ↓
Reason
  ↓
Each change addresses an observed race, contract mismatch or operational failure
with the smallest compatible primitive supported by the current architecture.
  ↓
Impact
  ↓
Deterministic domain state, safe retries, isolated presentation failure and
stronger regression protection without adding a distributed-lock subsystem.
```

The research recommendation is to retain optimistic room-version checks and action idempotency for the present single-process architecture. Redis `SET NX` is an O(1) conditional write and can combine with expiration [2]. Redis transactions serialize queued commands and `WATCH` aborts a stale optimistic transaction [3]. These facts support the current implementation; they do not justify adding a lock without evidence of multi-process contention.

---

## 16. Files Created

### Production source

| File | Purpose |
|---|---|
| `src/engine/roles/SilentMageRole.ts` | Silent Mage role metadata and validation. |

### New tests

| File | Purpose |
|---|---|
| `tests/engine/ConcurrencyAudit.test.ts` | Concurrent votes and split-finalizer races. |
| `tests/engine/ConcurrentGamesStress.test.ts` | Eight isolated games concurrently. |
| `tests/engine/InvariantAudit.test.ts` | Terminal, role, action, reset and dedup invariants. |
| `tests/engine/PlayerCountMatrix.test.ts` | 3–15 and invalid boundaries. |
| `tests/engine/RandomizedGameInvariant.test.ts` | 25 seeded randomized gameplay invariants. |
| `tests/engine/ResolutionOrderMatrix.test.ts` | Deterministic resolution and callback-order independence. |
| `tests/engine/RoleDistributionProperty.test.ts` | Distribution property tests across counts/seeds. |
| `tests/engine/RoomServiceJoinPrecedence.test.ts` | Room/session validation precedence. |
| `tests/engine/SilentMageDayService.test.ts` | Silence lifecycle and discussion enforcement. |
| `tests/engine/SilentMageDistribution.test.ts` | Explicit Silent Mage distribution. |
| `tests/engine/SilentMageNightResolver.test.ts` | Resolution order, caster death and target death. |
| `tests/engine/SilentMageRole.test.ts` | Role validation and repeat-target rule. |
| `tests/engine/SilentMageUnhappyEdgeE2E200.test.ts` | 200 adversarial Silent Mage case-runs. |
| `tests/telegram/BotPolicySilence.test.ts` | Bot Silence Gate policy. |
| `tests/telegram/KeyboardsSecurity.test.ts` | Callback shape, ballot and 64-byte security. |
| `tests/telegram/SilentMageE2E200.e2e.test.ts` | 200 full-flow E2E runs. |
| `tests/telegram/ballotToken.test.ts` | Ballot identity callbacks. |
| `tests/telegram/commands/HelpCommand.test.ts` | Help command contract. |
| `tests/telegram/commands/JoinCommand.test.ts` | Join command/error precedence. |

### Audit and evidence artifacts

| File | Purpose |
|---|---|
| `root-cause-analysis.md` | BUG-001 through BUG-009 RCA records. |
| `test-automation-completeness.md` | 49-suite/354-test coverage and category matrix. |
| `fixtures-inventory.md` | Reusable factory/helper inventory and recommendations. |
| `research-alternatives-evidence.md` | Telegram/Redis evidence and architecture recommendations. |
| `silent-mage-e2e-200-report.md` | 200 full-flow + 200 adversarial E2E report. |
| `bottest-stress-100-results.json` | 100-run stress metrics. |
| `silent-mage-e2e-200-results.json` | 200 full-flow metrics. |
| `silent-mage-unhappy-edge-e2e-200-results.json` | 200 adversarial metrics. |
| `final-layered-validation.log` | Post-fix full Jest validation log. |
| `final-full-regression.log` | Final build + full Jest regression log. |
| `coverage-summary.log` | Coverage run output. |
| `security-audit-2.log` | Callback security regression log. |
| `keyboard-security.log` | Earlier callback security evidence. |

---

## 17. Files Modified

The following source/test files were modified during the audit. No commit or merge was performed.

### Production source

`src/engine/DayService.ts`, `src/engine/GameOrchestrator.ts`, `src/engine/GameService.ts`, `src/engine/NightActionService.ts`, `src/engine/RoomService.ts`, `src/engine/RoomTimerService.ts`, `src/engine/domain/Player.ts`, `src/engine/domain/Room.ts`, `src/engine/domain/enums.ts`, `src/engine/errors/DomainError.ts`, `src/engine/events/DomainEvent.ts`, `src/engine/night/NightResolver.ts`, `src/engine/ports/StoragePort.ts`, `src/engine/role-distribution/RoleDistributionStrategy.ts`, `src/engine/roles/RoleRegistry.ts`, `src/engine/state-machine/GameStateMachine.ts`, `src/index.ts`, `src/infrastructure/redis/InMemoryStorageAdapter.ts`, `src/infrastructure/redis/RedisStorageAdapter.ts`, `src/telegram/BotDialogue.ts`, `src/telegram/BotPolicy.ts`, `src/telegram/GameFlowController.ts`, `src/telegram/MuteService.ts`, `src/telegram/commands/bottest.ts`, `src/telegram/commands/help.ts`, `src/telegram/handlers/actionCallbackHandler.ts`, `src/telegram/presenters/keyboards.ts`, `src/telegram/presenters/messages.ts`, and `src/telegram/presenters/translateError.ts`.

### Existing tests modified

`tests/engine/AllRolesAcceptance.test.ts`, `tests/engine/DayService.test.ts`, `tests/engine/GameOrchestrator.test.ts`, `tests/engine/GameStateMachine.test.ts`, `tests/engine/NightActionService.test.ts`, `tests/engine/RoleDistributionStrategy.test.ts`, `tests/engine/RoomService.test.ts`, `tests/engine/RoomTimerService.test.ts`, `tests/infrastructure/RedisStorageAdapter.test.ts`, `tests/telegram/GameFlowController.test.ts`, and `tests/telegram/MuteService.test.ts`.

### Generated/updated metric artifact

`bottest-stress-100-results.json` was updated by the stress run. The dev process was not stopped, and no commit/merge was executed.

---

## 18. Tests Added and Validation Results

| Category | Primary files | Cases/result |
|---|---|---|
| Unit/domain | Roles, SilentMageRole, RoleAssigner, WinConditionChecker | PASS in full suite. |
| Integration/application | RoomService, GameService, DayService, NightActionService, GameOrchestrator | PASS in full suite. |
| Game logic | NightResolver, VoteResolver, DeathQueue | PASS in full suite. |
| Role interactions | ResolutionOrderMatrix, SilentMageNightResolver, SilentMageDayService | PASS. |
| State machine | GameStateMachine, DayService | PASS. |
| Telegram command/callback | Command tests, action callback, keyboards, GameFlowController | PASS. |
| Idempotency/replay | Day/Night services, ballot token, invariants | PASS. |
| Concurrency | ConcurrencyAudit, ConcurrentGamesStress, speech-vote adversarial cases | PASS. |
| Persistence/Redis | RedisStorageAdapter and room persistence tests | PASS where Redis contract is available. |
| Timer/scheduler | RoomTimerService, BullMqSchedulerPort, orchestrator and controller timer tests | PASS. |
| Recovery | Room reset, persisted pending actions, overdue-room discovery and recovery paths | PASS/assessed; live process-kill restart remains staging task. |
| Randomized/property | RoleDistributionProperty, RandomizedGameInvariant | PASS. |
| Stress/performance | BottestStress100, SilentMageE2E200, 8 concurrent games | PASS. |
| Security | KeyboardsSecurity, callback handler and server-side domain validation | PASS; latest focused security run 17/17 tests. |
| Full regression | `npm run build && npx jest --runInBand --forceExit` | **49 suites, 354 tests PASS; build PASS; 17.856 s**. |
| Coverage | `npx jest --coverage --coverageReporters=text-summary` | Statements 78.38%, branches 63.31%, functions 78.05%, lines 80.51%. |

Post-fix layered validation also passed **49 suites and 354 tests** in 25.524 seconds. Jest prints a generic `--forceExit`/open-handles warning; this is recorded as an operational follow-up rather than hidden.

---

## 19. Remaining Risks

| Issue | Impact | Probability | Current workaround | Recommended solution | Priority |
|---|---|---|---|---|---|
| Multi-process same-room mutation is not proven | Two workers could both read the same version and repeatedly conflict or, if a path bypasses versioned write, risk lost update. | Medium if horizontally scaled; low in current single-process dev | Room version/freshness checks and atomic storage primitives. | Add per-room serialized queue or Redis CAS/transaction at every mutation boundary before horizontal scaling; measure stale conflicts first. | P1 |
| Redis outage/failover and network partition not chaos-tested | Session claim or room persistence may fail operationally during infrastructure incident. | Medium | Errors are surfaced and logged; application does not silently assume successful persistence. | Run staging fault injection, reconnect, failover and read/write timeout scenarios. | P1 |
| BullMQ worker restart with in-flight timers not executed | Phase may require overdue recovery or duplicate-job verification after restart. | Medium | Persisted absolute deadlines and overdue-room discovery; generation guards. | Process-kill canary in NIGHT/DISCUSSION/VOTING and assert one resolution. | P1 |
| Live Telegram rate-limit/permission/message lifecycle | UI may be delayed or incomplete even though game state remains correct. | Medium | Safe delivery wrapper and structured failure logs. | Canary with real 429, 5xx, delete/edit conflict and permission cases; add backoff policy if metrics require it. | P1 |
| No enforced CI coverage thresholds | Branch coverage can regress silently even though tests pass. | Medium | Current measured coverage and broad regression suite. | Add CI thresholds with an intentional ratchet, starting from current 78.38/63.31/78.05/80.51 values. | P2 |
| Jest `--forceExit` can mask cleanup defects | Leaked handles may not fail the default test command. | Low/Medium | Full tests pass; warning is recorded. | Add a separate non-force-exit CI job with `--detectOpenHandles` and bounded teardown. | P2 |
| Telemetry lacks production dashboard/alerting | Slow detection of stale callbacks, duplicate actions or Telegram delivery failures. | Medium | Structured logs and per-game telemetry. | Dashboard rates for `STALE_BALLOT`, `STALE_RESOLUTION`, stale timer, duplicate action, speech rejection and send failure. | P2 |
| No mutation testing | Some assertions may not detect a subtle rule mutation. | Low/Medium | Property/randomized/resolution matrix tests. | Add mutation testing selectively around resolver, win condition and Silence Gate. | P3 |
| No transactional outbox | State/event/message divergence could occur if persistence fails after an event append or vice versa. | Low in current scope; higher with distributed integration | Domain state remains authoritative and API delivery is isolated. | Add outbox only if production telemetry demonstrates event/state divergence or multi-process requirements. | P3 |

No remaining known Critical/High **tested** issue is open. The P1 items above are environment/deployment validation tasks rather than a claim that the current deterministic engine has an unresolved reproduced defect.

---

## Definition of Done — checklist verification

The master prompt contains 32 checklist lines. Each one is addressed below. `[x]` means completed in the tested scope; `[~]` means explicitly assessed but still requires external/staging validation.

| # | Checklist item | Status |
|---:|---|:---:|
| 1 | Toàn bộ architecture đã được audit | [x] |
| 2 | State machine đã được audit | [x] |
| 3 | Toàn bộ 7 role đã được test | [x] |
| 4 | Role interaction đã được test | [x] |
| 5 | Role resolution order đã được xác minh | [x] |
| 6 | Player count 3–15 đã được test | [x] |
| 7 | Boundary 1–2 và 16+ đã được test | [x] |
| 8 | Role distribution đã được test | [x] |
| 9 | Full game E2E đã được test | [x] |
| 10 | Village win đã được test | [x] |
| 11 | Wolf win đã được test | [x] |
| 12 | Invalid action đã được test | [x] |
| 13 | Duplicate action đã được test | [x] |
| 14 | Stale callback đã được test | [x] |
| 15 | Concurrent action đã được test | [x] |
| 16 | Race condition đã được audit | [x] |
| 17 | Idempotency đã được audit | [x] |
| 18 | Timer/scheduler đã được audit | [x] |
| 19 | Telegram API failure đã được test | [x] application-level mock; [~] live |
| 20 | DB/Redis failure đã được test | [x] adapter/contract; [~] chaos/failover |
| 21 | Restart/recovery đã được test hoặc risk đã được đánh giá rõ | [x] risk documented; [~] live process-kill |
| 22 | Stress test đã được thực hiện | [x] |
| 23 | Invariant test đã được implement | [x] |
| 24 | Root cause của bug đã được fix | [x] |
| 25 | Bug fix có regression test | [x] |
| 26 | Full regression đã pass | [x] |
| 27 | Không còn Critical/High issue chưa được xử lý hoặc giải thích | [x] |
| 28 | Không có known race condition nghiêm trọng | [x] trong tested scope; [~] multi-process |
| 29 | Không có known state corruption path chưa được xử lý | [x] trong tested scope |
| 30 | Test coverage được cải thiện | [x] |
| 31 | Logging/observability đủ để debug game issue | [x] application-level; [~] dashboard |
| 32 | Documentation được cập nhật khi architecture/logic thay đổi | [x] |

---

## Final Scoring

| Category | Score | Rationale |
|---|---:|---|
| Game Logic | 9.1/10 | Core rules, resolution, votes, win conditions and death chains have broad deterministic coverage. One point retained for environment-level and long-duration unknowns. |
| State Management | 8.8/10 | State machine, terminal behavior, versioning and reset paths are strong; multi-process authority is not fully proven. |
| Role System | 9.0/10 | All seven roles, metadata, validation and Silent Mage lifecycle are covered. |
| Concurrency | 8.4/10 | Critical races have targeted fixes and adversarial tests; Redis/BullMQ multi-worker contention remains untested. |
| Idempotency | 8.7/10 | Action IDs, ballots, speech event IDs and replay guards are covered; external duplicate delivery is mocked rather than live. |
| E2E Coverage | 9.0/10 | 200 full-flow plus 200 adversarial runs and broad scenario matrix; live integrations are outside the run. |
| Reliability | 8.0/10 | Safe Telegram failure isolation and partial-failure retention are implemented; real rate-limit/outage behavior remains to be canaried. |
| Recovery | 7.2/10 | Persisted fields, overdue scan and reset paths are present, but process-kill/BullMQ restart evidence is not yet available. |
| Error Handling | 8.5/10 | Serialized errors, structured context and failure isolation are strong; open-handle cleanup should receive a CI gate. |
| Performance | 8.8/10 | Low measured application-level latency and successful stress runs; production I/O profile is not represented. |
| Observability | 7.8/10 | Structured logs and telemetry exist, but dashboards/alerts and full correlation coverage should be expanded. |
| Maintainability | 8.0/10 | Factories, services and tests are understandable; fixture setup is somewhat duplicated and coverage thresholds are not enforced. |
| **OVERALL** | **8.44/10** | Strong, evidence-backed branch readiness for controlled canary; not a claim of unconditional production-wide readiness. |

---

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API — InlineKeyboardButton callback_data and callback queries"

[2]: https://redis.io/docs/latest/commands/set/ "Redis SET command — NX and expiration options"

[3]: https://redis.io/docs/latest/develop/using-commands/transactions/ "Redis Transactions — atomic execution and optimistic locking with WATCH/EXEC"

---

## Final handoff statement

Không commit hoặc merge tự động. Bot dev process của user không bị stop trong quá trình audit. Code, tests và artifacts nằm trên branch `feature/silent-mage`; bước tiếp theo an toàn nhất là review diff, chạy staging canary với Redis/BullMQ/Telegram thật, thực hiện process-kill recovery drill, rồi mới cân nhắc merge/deploy bằng quy trình của user.
