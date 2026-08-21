# Silent Mage — Contract Baseline và Test Plan

**Mục đích:** Chốt 5 contract blocker theo baseline deterministic, ít rủi ro và đủ cụ thể để bắt đầu viết test.  
**Phạm vi:** Domain contract, state transition, night effect, speech enforcement, announcement readiness, Hunter interaction, BotPolicy boundary và unit/integration test plan.  
**Trạng thái:** Test-ready baseline; chưa phải implementation và không thay đổi source code.  
**Đối tượng:** Developer, QA, reviewer state machine, owner vận hành.

---

## 1. Quyết định tóm tắt

Baseline dưới đây được chọn vì giữ `GameStateMachine` là nguồn sự thật, tái sử dụng optimistic locking/event pattern hiện có của `DayService`, tránh thêm một GameState mới trong đợt đầu và làm cho test có kết quả deterministic.

| Contract blocker | Baseline được chốt để viết test | Lý do tối ưu |
| --- | --- | --- |
| **1. Non-terminal transition** | `DISCUSSION → CHECK_WIN → VOTING` khi discussion death chưa kết thúc game; `CHECK_WIN → GAME_OVER` khi có winner. | Không bỏ qua ballot ngày hiện tại, không để room terminal giả dưới `DISCUSSION`, và giảm số nhánh phase phải duy trì. |
| **2. Silence persistence** | Silence có hiệu lực trong **một day discussion cycle duy nhất**, gắn với `matchId + currentRound + discussionCycleId`; hết khi chuyển khỏi cycle. Target chết trước khi day active thì không nhận active silence. | Tránh trạng thái câm rò sang ngày sau, dễ assert, dễ restart và không cần tracker dài hạn. |
| **3. Speech taxonomy** | Chỉ message trong group/supergroup thuộc `text`, `voice`, `sticker`, `animation/GIF` và loại speech đã whitelist mới là speech. Callback query, vote callback, private action callback và command `/vote` không phải speech. | Phù hợp middleware hiện tại và bảo vệ quyền vote của người đang câm. |
| **4. Hunter policy** | `SPOKEN_WHILE_SILENCED` **bật trong default `hunterTriggerCauses`**, nhưng Hunter trigger trong discussion dùng cùng một atomic resolution và chain-depth hiện có; Hunter không được tạo recursive chain vô hạn. Hunter prompt timeout mặc định là `SKIP`. | Bảo toàn quyết định thiết kế ban đầu, tạo coverage cho tương tác nguy hiểm nhất, và có timeout deterministic. |
| **5. BotPolicy simulation** | Bổ sung conceptual contract `silencedUntilRound`/cycle, `canSpeak`, `SPEECH_ATTEMPT`, cùng hai mode: normal compliant bot và deliberate-violation test bot. | Cho phép test behavior thật và phân biệt bot bị câm không nói với bot cố tình vi phạm; tránh false positive trong stress test. |

### 1.1. Một quyết định bổ sung cần phê duyệt

Baseline chọn **`CHECK_WIN → VOTING`** khi chưa thắng. Đây là lựa chọn nên dùng để viết test ngay. Nếu product owner muốn tiếp tục discussion sau death, đó là một profile khác và cần bộ test bổ sung; không thay đổi semantics của các test domain terminal, idempotency và readiness.

### 1.2. Non-goals của baseline

Baseline không cho phép đổi vote sau khi đã cast, không thay đổi cơ chế ballot hiện tại, không cho phép speech violation trong `OPENING`, không dùng Telegram mute API làm nguồn sự thật domain và không cho phép một action đã submit bị hủy chỉ vì caster chết cuối night.

---

## 2. Contract chi tiết

## 2.1. Contract C1 — Discussion death transition

### 2.1.1. State graph

```text
DAY
  └─ start discussion ─> DISCUSSION/OPENING
                              └─ announcement success ─> DISCUSSION/ACTIVE
                                  └─ valid speech violation ─> CHECK_WIN
                                      ├─ winner exists ─> GAME_OVER
                                      └─ no winner ─> VOTING
```

Discussion timeout bình thường vẫn đi theo `DISCUSSION → VOTING`. Discussion death không được đi thẳng `DISCUSSION → GAME_OVER` và không được đi `CHECK_WIN → NIGHT` khi chưa thắng. Transition phải đi qua `GameStateMachine.assertTransition`; không được raw-assign enum.

### 2.1.2. Preconditions

Một speech violation chỉ hợp lệ khi đồng thời thỏa các điều kiện sau:

| Mã | Điều kiện |
| --- | --- |
| C1-P01 | Room tồn tại và `chatId` của update khớp room binding. |
| C1-P02 | Room đang `gameState = DISCUSSION`. |
| C1-P03 | `discussionLifecycle = ACTIVE` và `discussionEnforcementReady = true`. |
| C1-P04 | `discussionCycleId` trong update context khớp cycle hiện tại. |
| C1-P05 | Speaker tồn tại trong room, còn sống và đang active silence. |
| C1-P06 | Message kind nằm trong speech whitelist. |
| C1-P07 | `speechEventId` chưa được xử lý thành công trong match/cycle. |
| C1-P08 | Resolution marker không cho thấy một discussion death khác đang finalize hoặc đã terminal. |

Nếu một precondition fail, result là no-op có reason xác định; không phát `PLAYER_DIED`, không gọi Hunter và không đổi phase.

### 2.1.3. Atomic operation

Operation logical `resolveDiscussionSpeechViolation` phải làm các bước sau trong một optimistic transaction/retry boundary:

1. Đọc room mới nhất và validate toàn bộ preconditions.
2. Dùng `speechEventId` làm idempotency key.
3. Tạo depth-0 death với cause `SPOKEN_WHILE_SILENCED`.
4. Chạy DeathQueue nếu cause nằm trong `hunterTriggerCauses`.
5. Áp dụng toàn bộ deaths hợp lệ lên player snapshot.
6. Chuyển logic từ `DISCUSSION` sang `CHECK_WIN` bằng state machine.
7. Chạy `WinConditionChecker` trên room sau death.
8. Chuyển `CHECK_WIN → GAME_OVER` nếu có winner; nếu chưa, chuyển `CHECK_WIN → VOTING`.
9. Persist một final room snapshot bằng expected version.
10. Append/publish events theo thứ tự đã định nghĩa.
11. Sau commit mới cancel discussion timer và khởi tạo voting orchestration nếu cần.

Nếu CAS conflict, bỏ local mutation, đọc lại room và retry cùng `speechEventId`. Nếu room đã chuyển phase hoặc speaker đã chết, trả stale/idempotent result, không giết lại.

### 2.1.4. Output contract

```text
accepted: boolean
reason: ACCEPTED | STALE_PHASE | NOT_READY | NOT_SILENCED |
        PLAYER_ALREADY_DEAD | DUPLICATE_EVENT | INVALID_MESSAGE_KIND |
        CONCURRENT_RESOLUTION
nextState: DISCUSSION | CHECK_WIN | VOTING | GAME_OVER
winner: NONE | VILLAGE | WEREWOLF
deaths: ordered array of { telegramId, cause }
events: ordered domain events
timerAction: NONE | CANCEL_DISCUSSION | START_VOTING
```

Ở output thành công terminal, `nextState = GAME_OVER`, có đúng một `GAME_ENDED` cho `resolutionId`. Ở output non-terminal, `nextState = VOTING` và `currentRound` giữ nguyên.

### 2.1.5. Event ordering

Thứ tự logical bắt buộc:

1. `SPEECH_VIOLATION` với `speechEventId`, speaker, message kind và cycle.
2. Một hoặc nhiều `PLAYER_DIED`, bắt đầu từ depth-0 rồi Hunter chain theo thứ tự ổn định.
3. `PHASE_CHANGED(DISCUSSION, CHECK_WIN)`.
4. `WIN_CONDITION_MET` nếu có winner.
5. `PHASE_CHANGED(CHECK_WIN, GAME_OVER)` hoặc `PHASE_CHANGED(CHECK_WIN, VOTING)`.
6. `GAME_ENDED` nếu terminal.

Nếu codebase chưa có `SPEECH_VIOLATION`, test contract có thể kiểm tra `PLAYER_DIED` và correlation metadata trước; nhưng event này phải được đưa vào implementation backlog vì cần audit duplicate/retry.

## 2.2. Contract C2 — Silence persistence và expiry

### 2.2.1. Lifetime

Một silence effect có key logic:

```text
matchId + currentRound + discussionCycleId + targetTelegramId
```

Silence bắt đầu có hiệu lực **sau khi night resolution hoàn tất, target còn sống và day discussion announcement đã activate**. Silence hết hiệu lực ngay khi discussion cycle kết thúc, dù cycle kết thúc do timeout, discussion death chuyển sang voting hay game over.

Silence không kéo dài sang round sau. Không cần `lastSilencedTarget` tracker vì repeat target được phép; chỉ cần active effect hiện tại.

### 2.2.2. Target filtering

| Tình huống | Kết quả |
| --- | --- |
| Target còn sống sau night finalize | Có thể tạo active silence cho cycle kế tiếp. |
| Target chết bởi Werewolf/Witch/Hunter cùng night | Không tạo active silence, không public silence announcement. |
| Caster chết sau khi submit hợp lệ | Action vẫn được resolve; caster alive cuối night không phải precondition finalize. |
| Caster chết trước khi submit | Submit bị từ chối. |
| Target chết sau khi day đã active | Xóa effect khỏi active set cùng death mutation; không phát speech violation cho target đó. |
| Target không còn trong room | Reject action. |
| Self-target | Reject action. |
| Repeat-target hai đêm liên tiếp | Accept nếu target hợp lệ và còn sống. |

### 2.2.3. Persistence invariant

`activeSilencedIds ⊆ alivePlayerIds` luôn đúng sau mọi room save. Một room cũ thiếu silence metadata được đọc theo default `no active silence`, không suy đoán là đang câm.

## 2.3. Contract C3 — Speech taxonomy và enforcement gate

### 2.3.1. Speech whitelist

| Update type | Là speech? | Có thể trigger death? |
| --- | --- | --- |
| Group text message | Có | Có nếu speaker active silenced và enforcement ready. |
| Group voice message | Có | Có. |
| Group sticker | Có | Có. |
| Group animation/GIF | Có | Có. |
| Group photo/video/document có caption | Chỉ có nếu product whitelist caption/media; baseline: caption là speech, media không caption là non-speech | Theo loại đã chọn. |
| `/vote` command | Không | Không. Command xử lý phase riêng. |
| Callback `action:VOTE:*` | Không | Không. Vote vẫn được phép khi silenced. |
| Callback night action | Không | Không. |
| Hunter shot callback | Không | Không. |
| Private message | Không thuộc discussion speech enforcement | Không. |
| Bot/system announcement | Không phải speech của player | Không. |

### 2.3.2. Readiness gate

Ba lifecycle values bắt buộc:

| Lifecycle | `discussionEnforcementReady` | Behavior |
| --- | --- | --- |
| `OPENING` | `false` | Pass-through; không tính speech violation. |
| `ACTIVE` | `true` | Enforce speech cho player đang silenced. |
| `CLOSED`/ngoài discussion | `false` hoặc không áp dụng | Không enforce Silent Mage speech. |

`OPENING` bắt đầu sau khi domain chuyển `DAY → DISCUSSION` nhưng trước khi announcement gửi thành công. Chỉ sau Telegram `sendMessage` success và CAS activation mới chuyển sang `ACTIVE`.

## 2.4. Contract C4 — Hunter trigger

Baseline bật `SPOKEN_WHILE_SILENCED` trong `hunterTriggerCauses` mặc định. Đây là default để test interaction không bị bỏ sót; room có thể tắt bằng settings nếu product muốn profile nhẹ hơn.

Hunter behavior:

1. Silent Mage violation là depth-0 death.
2. Nếu cause được bật, DeathQueue tạo pending Hunter prompt theo thứ tự deterministic.
3. Hunter không tự động được coi là đã bắn nếu không có decision; timeout là `SKIP`.
4. Hunter shot target phải còn sống tại thời điểm finalize và tuân theo target validation hiện tại.
5. DeathQueue không cho chain vô hạn; sử dụng depth limit hiện hành.
6. Discussion timer không được tự chuyển sang voting trong lúc resolution đang pending.
7. Finalize idempotent theo `resolutionId`; Hunter prompt retry không tạo death duplicate.

Nếu prompt Hunter cần asynchronous user input, integration test phải tách prepare/finalize. Unit test DeathQueue vẫn phải thuần và không phụ thuộc Telegram.

## 2.5. Contract C5 — BotPolicy

BotPolicy phải expose conceptual behavior sau:

| API/field contract | Semantics |
| --- | --- |
| `silencedUntilRound` hoặc cycle equivalent | Bot state active silence lifetime; không dùng memory-only nếu test restart cần cover. |
| `canSpeak(room, player)` | `false` khi player dead hoặc active silenced trong ACTIVE discussion; `true` trong OPENING vì chưa enforce, trừ khi test mode deliberate violation. |
| `recordSpeechAttempt(...)` | Ghi observation với event id, actor, cycle, kind, allowed/blocked và outcome. |
| `SPEECH_ATTEMPT` | Observation type riêng; không gộp vào `DISCUSSION` vì cần phân biệt speech bị chặn, speech hợp lệ và deliberate violation. |
| `normal` mode | Bot silenced không gửi discussion message. |
| `deliberateViolation` mode | Bot cố tình gửi một speech message đúng một lần theo test fixture để kiểm tra death. |
| `quiet` personality | Có thể không nói dù không bị câm; không được dùng quiet để chứng minh enforcement. |

`bottest` test room cần có role alias Silent Mage và fixture có thể chỉ định target/violation mode. Tuy nhiên, test domain không được phụ thuộc random personality hoặc `Math.random`; phải inject seed/deterministic decision.

---

# Phần I — Test contract

## 3. Quy ước test

Mỗi test phải assert cả **state**, **events**, **side effects** và **idempotency** khi applicable. Chỉ assert Telegram text là không đủ vì lỗi nguy hiểm nhất nằm ở phase, version, timer và duplicate mutation.

Fixture room chuẩn:

| Fixture | Mô tả |
| --- | --- |
| `roomDiscussionActive` | Room `DISCUSSION`, lifecycle `ACTIVE`, ready=true, round=1, một target silenced và đủ player để chưa thắng. |
| `roomDiscussionOpening` | Room `DISCUSSION`, lifecycle `OPENING`, ready=false, announcement chưa success. |
| `roomDiscussionTerminalByOneDeath` | Room mà chết một player sẽ làm `aliveWerewolves === 0` hoặc đạt parity. |
| `roomDiscussionNonTerminal` | Room mà chết một player chưa quyết định winner. |
| `roomNightPendingMage` | Room `NIGHT` có Silent Mage action đã submit. |
| `roomTargetDiesSameNight` | Mage action target player nhưng target nằm trong death set của night finalize. |
| `roomSilencedAliveVoting` | Room `VOTING`, player còn sống nhưng silence effect cũ/active metadata còn tồn tại. |
| `roomHunterEnabled` | `hunterTriggerCauses` có `SPOKEN_WHILE_SILENCED`. |
| `roomHunterDisabled` | Cause không nằm trong trigger list. |

Time phải là fake clock. Telegram, storage, event bus và scheduler phải là ports có spy/fake để kiểm tra call order và failure recovery.

## 4. Domain/state contract test cases

### 4.1. State machine và transition

| ID | Setup | Action | Expected |
| --- | --- | --- | --- |
| SM-DOM-001 | Room `DISCUSSION` | Assert transition tới `CHECK_WIN` | Pass. |
| SM-DOM-002 | Room `CHECK_WIN` | Assert tới `GAME_OVER` khi winner | Pass. |
| SM-DOM-003 | Room `CHECK_WIN` | Assert tới `VOTING` khi non-terminal | Pass theo baseline. |
| SM-DOM-004 | Room `DISCUSSION` | Resolve death non-terminal | Final state `VOTING`, không phải `NIGHT`. |
| SM-DOM-005 | Room `DISCUSSION` | Resolve death terminal | Final state `GAME_OVER`. |
| SM-DOM-006 | Room `GAME_OVER` | Submit stale speech event | No-op; state không đổi. |
| SM-DOM-007 | Room `VOTING` | Resolve stale discussion death | `STALE_PHASE`; không `PLAYER_DIED`. |
| SM-DOM-008 | Room `DAY` | Gọi discussion death | Reject invalid phase. |
| SM-DOM-009 | Any state | Raw direct transition bypass attempt in service test | Service phải sử dụng state machine; illegal transition throw. |

### 4.2. Preconditions và validation

| ID | Setup | Expected |
| --- | --- | --- |
| SM-VAL-001 | `discussionLifecycle=OPENING`, ready=false | `NOT_READY`, no death/no events. |
| SM-VAL-002 | Active discussion, speaker không tồn tại | Player-not-in-room error/no mutation. |
| SM-VAL-003 | Active discussion, speaker dead | `PLAYER_ALREADY_DEAD`, no Hunter. |
| SM-VAL-004 | Active discussion, speaker alive nhưng không silenced | `NOT_SILENCED`, no mutation. |
| SM-VAL-005 | Active discussion, invalid message kind | `INVALID_MESSAGE_KIND`. |
| SM-VAL-006 | `chatId` mismatch | Reject; no mutation. |
| SM-VAL-007 | Cycle mismatch | Stale result; no mutation. |
| SM-VAL-008 | Duplicate `speechEventId` | Idempotent result; one death maximum. |
| SM-VAL-009 | Silence expired at fake clock boundary | No death. |
| SM-VAL-010 | Silence active exactly at start boundary | Death accepted. |

### 4.3. Death, win check và events

| ID | Setup | Action | Expected |
| --- | --- | --- | --- |
| SM-DEATH-001 | Silenced villager speaks; non-terminal room | Resolve violation | Speaker dead with `SPOKEN_WHILE_SILENCED`; final `VOTING`; round unchanged. |
| SM-DEATH-002 | Last living werewolf is silenced speaker | Resolve violation | Village winner; `CHECK_WIN → GAME_OVER`; `WIN_CONDITION_MET` and `GAME_ENDED` exactly once. |
| SM-DEATH-003 | Speaker death creates werewolf parity | Resolve violation | Werewolf winner; final `GAME_OVER`. |
| SM-DEATH-004 | Multiple resolved deaths including Hunter | Resolve all | Deaths applied once in deterministic order; winner computed after all deaths. |
| SM-DEATH-005 | Win check before applying death is inconclusive | Resolve | Checker called with post-death room; terminal result reflects death. |
| SM-DEATH-006 | Non-terminal resolution | Inspect `currentRound` | No increment. |
| SM-DEATH-007 | Speaker is active silence target | Resolve | Silence removed/irrelevant after death; no orphan active target. |
| SM-DEATH-008 | Event bus throws after storage save | Resolve | Room remains final; event retry identity/logging exists; mutation not rerun. |
| SM-DEATH-009 | Event append fails | Resolve | Error is observable/retryable; no second death on retry. |
| SM-DEATH-010 | CAS conflict once then success | Resolve | One final death; retry count=1; events published once. |
| SM-DEATH-011 | CAS conflicts until exhausted | Resolve | No partial local state exposed; structured failure/alert. |

Event assertion helper must validate sequence, `roomId`, `matchId`, `round`, `resolutionId`, actor and cause. Tests must distinguish “event not emitted” from “event emitted twice”.

### 4.4. Silence night-resolution contract

| ID | Setup | Action | Expected |
| --- | --- | --- | --- |
| SM-NIGHT-001 | Mage alive, target alive, valid action | Resolve night | Target becomes active silence for next cycle. |
| SM-NIGHT-002 | Mage submits then dies same night | Resolve night | Target effect remains valid if target alive; caster death does not cancel action. |
| SM-NIGHT-003 | Target dies in same night | Resolve night | No active silence; no public silence announcement for target. |
| SM-NIGHT-004 | Mage submits after already dead | Submit | Dead-player rejection. |
| SM-NIGHT-005 | Self-target | Submit | Invalid target rejection. |
| SM-NIGHT-006 | Same target consecutive nights | Submit twice on different rounds | Accepted both times. |
| SM-NIGHT-007 | Target alive then dies during day | Apply death | Active silence removed/ignored; no later violation. |
| SM-NIGHT-008 | New round begins | Inspect old silence | Previous cycle silence absent. |
| SM-NIGHT-009 | Restart after night finalize | Reload room | Silence metadata survives if target alive; no loss/duplication. |
| SM-NIGHT-010 | Restart before finalization | Reload pending actions | Submitted Mage action remains resolvable exactly once. |

### 4.5. Speech taxonomy and callback isolation

| ID | Update | Expected |
| --- | --- | --- |
| SM-SPEECH-001 | Silenced player sends group text in ACTIVE | One violation/death. |
| SM-SPEECH-002 | Silenced player sends group voice | One violation/death. |
| SM-SPEECH-003 | Silenced player sends sticker | One violation/death. |
| SM-SPEECH-004 | Silenced player sends GIF/animation | One violation/death. |
| SM-SPEECH-005 | Silenced player sends `/vote` | No speech violation; command handled by phase contract. |
| SM-SPEECH-006 | Silenced player presses vote callback in `VOTING` | Vote accepted if alive. |
| SM-SPEECH-007 | Silenced player presses night action callback | Callback behavior unaffected by silence. |
| SM-SPEECH-008 | Silenced player sends speech in `OPENING` | No death/no violation observation as enforced outcome. |
| SM-SPEECH-009 | Dead player sends speech | No second death. |
| SM-SPEECH-010 | Message from private chat | Not discussion speech. |
| SM-SPEECH-011 | System announcement | Not attributed to player. |
| SM-SPEECH-012 | Group media without whitelisted caption | Result matches explicit media policy; baseline must be fixed before implementation. |

### 4.6. Hunter contract

| ID | Setup | Expected |
| --- | --- | --- |
| SM-HUNTER-001 | Trigger cause enabled; speaker violation | Hunter pending action created. |
| SM-HUNTER-002 | Trigger cause disabled | Speaker death only; no pending Hunter. |
| SM-HUNTER-003 | Hunter chooses living target | Target dies with `HUNTER_SHOT`; chain depth bounded. |
| SM-HUNTER-004 | Hunter chooses dead/invalid target | Decision rejected or treated as skip per existing policy; no invalid death. |
| SM-HUNTER-005 | Hunter timeout | Skip; resolution completes once. |
| SM-HUNTER-006 | Duplicate Hunter finalize | No duplicate target death/events. |
| SM-HUNTER-007 | Discussion timer fires while Hunter prompt pending | Timer no-op; does not start voting before finalize. |
| SM-HUNTER-008 | Two triggers in one operation | DeathQueue depth policy is deterministic; no infinite recursion. |

### 4.7. BotPolicy contract

| ID | Setup | Expected |
| --- | --- | --- |
| SM-BOT-001 | Normal bot active silence | `canSpeak=false`; scheduled discussion message skipped. |
| SM-BOT-002 | Normal bot not silenced | Bot may speak according to personality. |
| SM-BOT-003 | Deliberate violation mode | Exactly one speech attempt emitted. |
| SM-BOT-004 | Deliberate violation mode after bot death | No speech attempt/death. |
| SM-BOT-005 | `SPEECH_ATTEMPT` observation | Contains actor, cycle, kind, allowed/blocked and event id. |
| SM-BOT-006 | Quiet personality without silence | No message is not evidence of enforcement; observation distinguishes personality. |
| SM-BOT-007 | Bot callback vote while silenced | Vote still submitted. |
| SM-BOT-008 | Bot state reload | Silence lifetime and cycle restored deterministically. |
| SM-BOT-009 | Same random seed | Same bot actions and observations. |
| SM-BOT-010 | Different seed | May differ, but domain invariants remain identical. |

---

# Phần II — Unit test plan

## 5. Unit test suite structure

Unit tests phải tách pure domain khỏi orchestration. Không gọi Telegram thật, Redis thật hoặc BullMQ thật trong unit suite.

| Suite | Đơn vị kiểm tra | Dependencies |
| --- | --- | --- |
| `GameStateMachine` | Transition table và terminal states | Không dependency. |
| `WinConditionChecker` | Winner calculation | Pure room fixtures. |
| `SilentMageActionPolicy` | Self-target, alive target, repeat target, caster-at-submit | Fake room/time. |
| `SpeechClassifier` | Message kind và context classification | Synthetic Telegram update fixtures. |
| `SpeechEnforcementPolicy` | Ready gate, silence active, dead/silenced logic | Pure player/room state. |
| `DiscussionDeathResolver` | Death list, DeathQueue integration, win branch | Fake `WinConditionChecker`/DeathQueue nếu cần. |
| `DiscussionResolutionService` | CAS retry, event ordering, state transitions | Fake storage/event bus/clock. |
| `SilenceEffectResolver` | Night action finality và target filtering | Fake pending actions/room. |
| `BotPolicy` | canSpeak, deliberate violation, observation | Deterministic RNG. |
| `TimerGuard` | Stale timer conditions | Fake room/time/scheduler. |

## 6. Unit fixture requirements

Mọi fixture phải tạo room hợp lệ qua factory/helper và chỉ override field cần thiết. Không dùng object literal thiếu field vì dễ làm test pass sai do schema không đầy đủ.

Fixture builder phải hỗ trợ:

- role map cố định cho `VILLAGER`, `WEREWOLF`, `SILENT_MAGE`, `HUNTER`, `SEER`, `WITCH`;
- `gameState`, `discussionLifecycle`, readiness và cycle id;
- `currentRound`, `matchId`, `version`;
- active silence set có expiry;
- `hunterTriggerCauses` bật/tắt;
- deterministic `now`, `speechEventId`, `resolutionId`;
- injected CAS conflict count;
- fake event bus/scheduler/Telegram response.

## 7. Unit exit criteria

Unit phase chỉ đạt pass khi:

1. Tất cả test `SM-DOM`, `SM-VAL`, `SM-DEATH`, `SM-NIGHT`, `SM-SPEECH`, `SM-HUNTER` và `SM-BOT` liên quan đều pass.
2. Không có test dùng real time, random không seed hoặc Telegram network.
3. Mọi mutation terminal đều có assertion event count và final state.
4. Mọi retry test chứng minh không duplicate death.
5. Coverage không chỉ đo line coverage; phải có branch coverage cho winner/non-winner, ready/not-ready, trigger on/off, CAS success/conflict/exhaustion và target alive/dead.
6. Test timeout không được vượt budget cố định; các async promise phải được await đầy đủ.

---

# Phần III — Integration test plan

## 8. Integration test topology

Integration test dùng storage adapter test hoặc Redis test instance, nhưng không gọi Telegram production. Các adapter cần có failure injection.

| Adapter | Behavior cần mô phỏng |
| --- | --- |
| Storage | Get/save CAS, action idempotency, room reload, event append. |
| EventBus | Capture order, throw sau commit, retry. |
| Telegram gateway | Send success/failure/delay, response message id. |
| Scheduler/BullMQ adapter | Schedule, cancel, stale job delivery, duplicate job delivery. |
| Clock | Fake time và boundary expiry. |
| Hunter prompt gateway | Immediate choice, timeout, duplicate callback. |
| BotPolicy | Normal/deliberate violation and deterministic observations. |

## 9. Integration scenario matrix

### 9.1. Opening/readiness flow

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-OPEN-001 | Happy path | Start discussion, send announcement success, activate gate, schedule timer | State `DISCUSSION/ACTIVE`, ready=true, one announcement, one timer. |
| INT-OPEN-002 | Speech before send success | Persist opening, delay Telegram response, inject speech | No death/no Hunter; after activation later messages enforce. |
| INT-OPEN-003 | Telegram failure | Opening, send fails | ready=false, no timer, retry record exists. |
| INT-OPEN-004 | Retry success | Previous failure, retry send success, activate | One active cycle; timer created once; gate transitions false→true once. |
| INT-OPEN-005 | CAS activation conflict | Send success, mutate room elsewhere before activation | Activation rejected/reloaded; stale cycle cannot enable enforcement. |
| INT-OPEN-006 | Process restart before send | Persist opening, restart service | Recovery sends/continues opening; no enforcement. |
| INT-OPEN-007 | Process restart after send before activate | Simulate checkpoint | Activation recovery succeeds; no early violation. |
| INT-OPEN-008 | Duplicate startup recovery | Run recovery twice | No duplicate activation/timer beyond idempotent scheduler key. |

### 9.2. Discussion death flow

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-DISC-001 | Non-terminal violation | Active silenced speaker sends text | One death, event sequence valid, final `VOTING`, round unchanged. |
| INT-DISC-002 | Village win | Last werewolf violates silence | Final `GAME_OVER`, winner village, game-over side effect once. |
| INT-DISC-003 | Werewolf parity win | Speaker death reaches parity | Final `GAME_OVER`, winner werewolf. |
| INT-DISC-004 | Timer race | Delay death save and fire discussion timeout | Exactly one winner of CAS; no invalid transition/no duplicate execution. |
| INT-DISC-005 | Two simultaneous violations | Two speakers send at same time | One or two deaths only if sequentially valid; no duplicate speaker death; final winner correct. |
| INT-DISC-006 | Stale event after voting | Transition to voting then deliver old speech update | No death; stale reason recorded. |
| INT-DISC-007 | Event publish fault | Commit room then fail publish | Final room remains correct; retry does not kill again. |
| INT-DISC-008 | Timer cancel fault | Terminal resolution with scheduler cancel failure | Room remains `GAME_OVER`; stale timer later no-ops; alert emitted. |

### 9.3. Night resolution and persistence flow

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-NIGHT-001 | Valid Mage action | Submit action, resolve night, target alive | Active silence appears for next cycle only. |
| INT-NIGHT-002 | Caster dies after submit | Submit Mage action, kill Mage in same night, resolve | Action remains final; target effect applies if target alive. |
| INT-NIGHT-003 | Target dies same night | Submit action, target killed by another effect, finalize | Target absent from active silence and announcement list. |
| INT-NIGHT-004 | Restart with pending action | Submit then restart before resolve | Pending action survives; resolution once. |
| INT-NIGHT-005 | Repeat target | Two night cycles same target | Both actions accepted; no false repeat-target error. |
| INT-NIGHT-006 | Silence expires | Move from discussion to next round | Previous active silence no longer enforced. |

### 9.4. Callback vote isolation

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-VOTE-001 | Silenced player callback vote | Keep player alive/silenced, transition to voting, submit callback | `VOTE_CAST`; no speech observation/death. |
| INT-VOTE-002 | Dead player callback vote | Kill voter, submit callback | Dead-player rejection; no vote. |
| INT-VOTE-003 | Speech middleware and callback concurrency | Send text and click vote concurrently | Each path applies own contract; speech does not cancel valid callback. |
| INT-VOTE-004 | `/vote` command | Silenced player uses command | No `SPOKEN_WHILE_SILENCED`; command handled by command policy. |

### 9.5. Hunter integration

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-HUNTER-001 | Trigger enabled | Speech violation, Hunter prompt, valid shot | Ordered deaths, one finalize, winner checked after chain. |
| INT-HUNTER-002 | Trigger disabled | Same violation | Speaker only; no prompt/no Hunter death. |
| INT-HUNTER-003 | Hunter timeout | Prompt expires | Skip; discussion resolution continues to `VOTING` or `GAME_OVER`. |
| INT-HUNTER-004 | Duplicate prompt callback | Submit Hunter decision twice | One accepted, one duplicate/no-op. |
| INT-HUNTER-005 | Discussion timer overlap | Hunter prompt held until timer deadline | Timer does not start voting; finalize owns phase transition. |

### 9.6. BotPolicy integration

| ID | Scenario | Steps | Assertions |
| --- | --- | --- | --- |
| INT-BOT-001 | Normal bot silenced | Set active silence, run scheduled chat | No group speech message; no violation. |
| INT-BOT-002 | Deliberate violation | Set test mode, run one scheduled attempt | One speech update enters engine and creates expected result. |
| INT-BOT-003 | Silenced bot vote | Transition to voting, execute callback vote | Vote succeeds. |
| INT-BOT-004 | Restart bot room state | Persist policy state, reload | Same silence/cycle and deterministic behavior. |
| INT-BOT-005 | 100-round regression | Run all supported role profiles with deterministic seeds | No invalid phase, duplicate death, stale timer or unhandled rejection. |

## 10. Integration assertions beyond final state

Mỗi scenario phải kiểm tra bốn lớp output:

| Lớp | Assertion |
| --- | --- |
| Domain snapshot | `gameState`, lifecycle, readiness, players alive/dead, silence set, round, version. |
| Event log | Types, order, count, correlation IDs and winner/death cause. |
| External side effects | Telegram calls, delete/mute/unmute calls, scheduler schedule/cancel calls, Hunter prompt. |
| Recovery/idempotency | Replaying same update/job/event does not duplicate mutation. |

Không được coi test pass nếu final state đúng nhưng event order sai, timer còn active sau game over hoặc callback vote bị chặn.

## 11. Failure injection matrix

| Fault | Expected behavior |
| --- | --- |
| Storage read timeout | Request fails/retries according to service policy; no assumed silence/death. |
| CAS conflict | Re-read and retry; one final mutation. |
| Idempotency store unavailable | Fail closed or explicit retry; không tự coi event mới là safe để kill. |
| Telegram announcement timeout | Gate remains false; retryable opening. |
| Telegram death announcement failure | Domain commit remains; notification retry/outbox and alert. |
| Scheduler schedule failure | Active state remains; persisted deadline allows recovery. |
| Scheduler cancel failure | Terminal state remains; stale job no-op. |
| Event append failure | No mutation replay; event identity used for retry. |
| Event bus publish failure | Final room remains; publish retry/alert. |
| Hunter prompt gateway failure | Deterministic timeout/skip; finalize once. |

---

# Phần IV — Traceability và execution order

## 12. Traceability matrix

| Contract | Unit tests | Integration tests | Acceptance gate |
| --- | --- | --- | --- |
| C1 transition | SM-DOM, SM-DEATH | INT-DISC | `TS-DOM-01..07` |
| C2 silence persistence | SM-NIGHT | INT-NIGHT | `TS-DOM-08`, target-dead invariant |
| C3 speech/readiness | SM-VAL, SM-SPEECH | INT-OPEN, INT-VOTE | `TS-RACE-01..07` |
| C4 Hunter | SM-HUNTER | INT-HUNTER | Hunter trigger/timeout/no duplicate |
| C5 BotPolicy | SM-BOT | INT-BOT | Bot deterministic simulation and telemetry |
| Optimistic/idempotency | SM-DEATH | INT-DISC, fault injection | No duplicate mutation |
| Timer/restart | TimerGuard | INT-OPEN, restart scenarios | `TS-OPS-01..05` |

## 13. Thứ tự viết test khuyến nghị

### Sprint/Test batch 1 — Pure domain

Bắt đầu với `GameStateMachine`, `WinConditionChecker`, target policy, speech classifier và silence expiry. Những test này không cần schema đầy đủ của Telegram hoặc storage và sẽ khóa luật cốt lõi sớm nhất.

### Sprint/Test batch 2 — Resolution service

Tiếp theo viết death resolver, DeathQueue interaction, event ordering, winner branch và CAS retry. Đây là batch quan trọng nhất vì bảo vệ dữ liệu và state transition.

### Sprint/Test batch 3 — Opening lifecycle và timer

Viết fake Telegram gateway, storage version conflict, readiness activation, retry/recovery và stale timer. Không bật E2E speech trước khi batch này pass.

### Sprint/Test batch 4 — Telegram boundary và callback isolation

Thêm update fixtures cho text/voice/sticker/GIF, command và callback. Assert message path không can thiệp callback vote.

### Sprint/Test batch 5 — Hunter/BotPolicy

Tách Hunter prepare/finalize, timeout và deterministic bot modes. Sau đó mới chạy 100-round regression.

## 14. Go/no-go criteria

### Có thể bắt đầu viết test ngay khi

1. Team chấp nhận baseline `CHECK_WIN → VOTING` cho non-terminal.
2. Silence lifetime là một `matchId + round + discussionCycleId`.
3. Speech whitelist và callback exclusion được coi là normative.
4. Hunter trigger default bật và timeout là `SKIP`.
5. BotPolicy có normal và deliberate-violation test mode.

### Chưa được merge implementation nếu

- Có bất kỳ raw state mutation bypass `GameStateMachine`.
- Speech trong `OPENING` tạo death.
- Silenced alive player không callback vote được.
- Target chết cùng night vẫn xuất hiện trong active silence/public announcement.
- Caster chết cùng night làm mất action đã submit hợp lệ.
- CAS/retry tạo duplicate `PLAYER_DIED` hoặc `GAME_ENDED`.
- Timer stale chuyển room sang voting sau `GAME_OVER`.
- Hunter prompt có thể finalize hai lần.

### Chưa được bật production nếu

- Unit và integration suite pass nhưng chưa có restart/concurrency test.
- Chưa có metrics cho opening recovery, CAS conflict, duplicate event và stale timer.
- Chưa chạy 100-round regression với cả profile có và không có Silent Mage.
- Chưa có rollback procedure và canary observation.

## 15. Kết luận

Baseline này đủ cụ thể để đội bắt đầu viết test ngay mà không phải chờ implementation hoàn chỉnh. Lựa chọn tối ưu là giữ state transition chính thức, kết thúc discussion bằng `CHECK_WIN → VOTING` khi chưa thắng, giới hạn silence trong một discussion cycle, coi speech là whitelist message-only, bật Hunter trigger mặc định với timeout `SKIP`, và mô phỏng BotPolicy bằng state deterministic cùng deliberate-violation mode.

Cách tiếp cận này ưu tiên **tính kiểm chứng và khả năng phục hồi** hơn việc giảm số dòng code ban đầu. Các test phải chứng minh không chỉ luật role đúng mà còn chứng minh phase, event, timer, callback vote, restart và retry không làm hỏng flow hiện tại.

## References

[1]: silent-mage-technical-spec.md "Technical Specification Silent Mage"
[2]: silent-mage-design-audit-v2.md "Audit vòng 2 các blocker và phương án A/B"
[3]: src/engine/state-machine/GameStateMachine.ts "Transition table và assertTransition"
[4]: src/engine/DayService.ts "Optimistic retry, event ordering, execution resolution và vote contract"
[5]: src/engine/night/NightResolver.ts "Night action finality, action order và death finalization"
[6]: src/engine/night/DeathQueue.ts "Hunter trigger causes và chain-depth policy"
[7]: src/engine/win-condition/WinConditionChecker.ts "Pure win-condition checker"
[8]: src/telegram/GameFlowController.ts "Discussion orchestration, timer handling và bot simulation"
[9]: src/index.ts "Message middleware, callback separation và overdue room resume"
[10]: src/telegram/handlers/actionCallbackHandler.ts "Callback vote/night action handler"
[11]: src/telegram/BotPolicy.ts "Bot simulation, observation và personality state"
[12]: src/telegram/commands/bottest.ts "Bottest fixture/role setup"
[13]: src/engine/domain/Room.ts "RoomState, GameSettings, version và pending night actions"
[14]: src/engine/domain/Player.ts "PlayerState, alive state và killPlayer contract"
