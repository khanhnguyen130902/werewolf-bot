# Silent Mage — Phân tích race condition giữa Speech Event và Vote Callback

**Phạm vi:** runtime log hiện có, Silence Gate, `DayService`, callback vote, timer/orchestration và concurrency tests.  
**Branch kiểm tra:** `feature/silent-mage`  
**Kết luận ngắn:** optimistic locking đã bảo vệ state commit cơ bản và test mixed speech-vote hiện pass, nhưng hệ thống vẫn có race window ở timer/orchestration, stale callback, asynchronous Hunter prompt và event-log ordering. Chưa nên coi flow speech-vote là production-safe cho đến khi các P0/P1 dưới đây được xử lý.

## 1. Evidence từ log runtime

Log hiện có **chưa chứa `SPEECH_VIOLATION` hoặc `VOTE_CAST` event-level trace**, vì implementation hiện tại chưa log trực tiếp `speechEventId`, `discussionCycleId`, `room.version` hay `actionId` tại hai boundary. Do đó không thể khẳng định từ log production rằng một speech event cụ thể đã cạnh tranh với một vote callback cụ thể. Tuy nhiên, log cung cấp bằng chứng rõ về stale phase/resume behavior:

| Thời điểm | Log | Ý nghĩa |
| --- | --- | --- |
| 11:39:32 | `Resuming overdue room ... in state DISCUSSION` | Process khởi động lại khi room đang ở DISCUSSION. |
| 11:39:36 | `/vote received` rồi `INVALID_PHASE_ACTION` | Vote callback/command đến trong khi application vẫn xác định phase chưa hợp lệ. |
| 11:39:37 | `/status completed ... gameState: VOTING` | State chuyển sang VOTING ngay sau đó; đây là dấu hiệu của phase transition cạnh tranh hoặc resume timing, không phải bằng chứng speech-specific. |
| 11:45:44 | `Checked all night actions submitted ... false` | Orchestration kiểm tra snapshot chưa đủ action. |
| 12:48:57–12:48:58 | `allSubmitted false` rồi `true`, sau đó resolve night | Các callback gần nhau có thể kích hoạt nhiều follow-up async; cơ chế guard hiện có ở night/execution cần được giữ nguyên. |

Log cũng cho thấy nhiều lần `ts-node-dev` restart liên tiếp khi file được sửa. Điều này làm tăng khả năng timer cũ, callback cũ và room snapshot cũ cùng tồn tại trong quá trình phát triển local; production phải kiểm tra riêng restart/resume với Redis thật.

## 2. State authority và thứ tự commit hiện tại

Speech path gọi `recordActionIdIfNew`, đọc initial room, có thể chờ Hunter prompt, rồi chạy `withRetry`. Trong mutation closure, Silence Gate kiểm tra `DISCUSSION`, `ACTIVE`, `discussionEnforcementReady`, `silencedPlayerId`, round và `discussionCycleId`. Nếu hợp lệ, service tạo death, chạy win check và persist trực tiếp state cuối là `VOTING` hoặc `GAME_OVER`.

Vote callback đi qua `actionCallbackHandler`, lấy room từ player session rồi gọi `DayService.submitVote`. Vote service chỉ chấp nhận khi `room.gameState === VOTING`, kiểm tra player/target còn sống, kiểm tra `hasVotedThisRound`, rồi save bằng optimistic version. Vì cả speech và vote đều dùng `saveRoom(expectedVersion)`, hai mutation không thể cùng ghi thành công trên cùng version trong adapter đúng contract.

Tuy nhiên, `appendEvents` và `eventBus.publishAll` xảy ra **sau** `saveRoom` và ngoài transaction. Vì vậy state version có thể đúng trong Redis nhưng thứ tự event log/publish giữa speech và vote vẫn có thể lệch theo thời điểm mạng và scheduler.

## 3. Race matrix

| ID | Race window | Kết quả hiện tại | Mức độ | Đánh giá |
| --- | --- | --- | --- | --- |
| R1 | Speech violation và vote callback cùng đến khi room còn DISCUSSION | Một bên thắng CAS; speech có thể đưa room sang VOTING, vote trước đó bị `INVALID_PHASE_ACTION`; nếu speech thắng trước, vote sau có thể được chấp nhận ở VOTING. | P1 | State không double-commit; semantics cần được ghi rõ là callback đến sau transition được phép vote. |
| R2 | Speech violation và `DISCUSSION_TIMEOUT` cùng chạy | Timer handler chỉ kiểm tra `gameState === DISCUSSION`, không kiểm tra `discussionLifecycle`/`discussionEnforcementReady`. CAS thường khiến một bên thất bại, nhưng bên thất bại có thể ném `InvalidPhaseActionError` ra ngoài callback timer. | **P0** | Có nguy cơ unhandled rejection, log nhiễu và duplicate orchestration nếu handler tương lai thêm side effect trước retry. |
| R3 | Speech commit sang VOTING trong lúc `presentVoting`/bot voting đang chạy | State CAS bảo vệ phase, nhưng presentation và bot-vote scheduling là application side effect ngoài state transaction. Không có persisted `ballotCycleId` hoặc shared phase-presentation lock. | P1 | Có thể gửi duplicate voting announcement hoặc bot vote trên snapshot cũ nếu nhiều caller gọi orchestration. |
| R4 | Speech event chờ Hunter prompt trong khi vote/timer chuyển phase | Hunter prompt được chuẩn bị từ `initialRoom` trước mutation CAS. Trong thời gian chờ người dùng, room có thể đã sang VOTING/GAME_OVER; prompt vẫn tồn tại và decision sau đó bị dùng trên snapshot stale hoặc bị loại khi commit retry. | **P0** | Người chơi có thể thấy prompt Hunter không còn hợp lệ; cần two-step prepare/finalize có cycle/version guard. |
| R5 | Vote callback và `resolveExecution` cùng chạy sau lá phiếu cuối | `resolvingExecutionRooms` đã giảm rủi ro double execution ở GameFlowController. `submitVote` vẫn CAS/hasVoted guard. | P1 | State thường an toàn, nhưng callback có thể update keyboard bằng snapshot cũ và UI không phản ánh phase ngay lập tức. |
| R6 | Callback từ keyboard cũ đến sau khi phase/ballot mới mở | Callback data hiện không mang `discussionCycleId`, `ballotId` hoặc round token; action handler chỉ dựa vào player session và phase hiện tại. | **P0** | Một callback cũ có thể được tính vào ballot mới nếu người chơi chưa có `hasVotedThisRound`, đặc biệt sau restart hoặc round rollover. |
| R7 | Speech/vote save thành công nhưng append event/publish bị chậm hoặc fail | Room state đã đổi nhưng audit event có thể đến sau, sai thứ tự hoặc thiếu nếu append không retry/outbox. | P1 | Replay/audit có thể không phản ánh thứ tự state commit. |
| R8 | Duplicate action ID được record trước khi phase validation | Speech/vote request stale bị đánh dấu đã dùng trước khi biết phase hợp lệ. Retry cùng update sau khi phase mở có thể nhận `DUPLICATE_ACTION`. | P1 | Không làm sai state nhưng làm retry UX khó hiểu; action-id nên gắn với semantic attempt và có outcome policy rõ ràng. |
| R9 | `GameOrchestrator.roleHasNightAction` không bao gồm `SILENT_MAGE` | `allNightActionsSubmitted` có thể coi night đã đủ action dù Silent Mage chưa submit. | **P0** | Role có thể bị bỏ qua hoặc silence không được submit trước khi night resolve. Đây là defect độc lập nhưng tác động trực tiếp đến silence timing. |
| R10 | Timer được schedule khi room chỉ ở `DISCUSSION` nhưng lifecycle còn `OPENING` | `scheduleCurrentPhaseTimer` chỉ nhìn `gameState`; opening vẫn có thể nhận discussion timer. | P1 | Timer có thể đẩy room sang voting khi announcement chưa hoàn tất hoặc sau restart opening. |

## 4. Mixed concurrency tests đã chạy

Đã bổ sung và chạy test contract trong `tests/engine/SilentMageDayService.test.ts`:

| Scenario | Kết quả |
| --- | --- |
| Hai speech event cùng target | PASS; chỉ một request được `accepted`, một death được commit. |
| Speech event trùng `speechEventId` | PASS; lần thứ hai bị duplicate. |
| Speech event và vote callback đồng thời | PASS; không có duplicate speech death, final room là VOTING. |
| Vote callback sau speech transition | PASS khi voter và target còn hợp lệ. |
| Gate persistence qua storage reload | PASS. |
| Stale discussion cycle activation | PASS; bị reject. |

Các test trên chứng minh **domain CAS boundary hiện không double-commit trong adapter test**, nhưng chưa chứng minh toàn bộ Telegram/timer/event-bus orchestration là race-free.

## 5. Invariants cần giữ

> Một speech violation hợp lệ chỉ được tạo tối đa một death cho một `speechEventId` và một `discussionCycleId`.

> Một room chỉ được có một state transition hợp lệ từ `DISCUSSION` cho một cycle; mọi caller stale phải trở thành no-op hoặc stale rejection có kiểm soát, không tạo side effect trình bày.

> Vote chỉ được ghi vào đúng `ballotId`/round hiện tại; callback từ keyboard cũ phải bị reject trước khi mutate.

> `SPEECH_VIOLATION`, `PLAYER_DIED`, `PHASE_CHANGED`, `VOTE_CAST` phải có sequence/commit version đơn điệu trong event log.

> Hunter prompt chỉ được mở khi precondition còn đúng và decision chỉ được finalize nếu `room.version`, `discussionCycleId` và phase generation vẫn khớp.

## 6. Mitigation ưu tiên

### P0 — phải xử lý trước production

Thứ nhất, thêm `phaseGeneration` hoặc `discussionCycleId` vào timer payload và vote callback payload. `DISCUSSION_TIMEOUT` chỉ được xử lý khi `gameState === DISCUSSION`, `discussionLifecycle === ACTIVE`, `discussionEnforcementReady === true` và generation vẫn khớp. Handler phải bắt stale/invalid-phase thành một no-op có log debug, không để exception thoát khỏi worker.

Thứ hai, thêm `ballotId`/`ballotGeneration` vào vote keyboard và `submitVote`. Callback phải bị reject nếu token không khớp room ballot hiện tại. Đây là cách trực tiếp nhất để ngăn stale callback từ keyboard cũ được tính vào ballot mới.

Thứ ba, sửa `GameOrchestrator.roleHasNightAction` để lấy từ RoleRegistry/RoleDefinition hoặc ít nhất bao gồm `SILENT_MAGE`. Nếu không sửa, test resolver riêng vẫn pass nhưng runtime night flow có thể resolve trước khi Silent Mage action được submit.

Thứ tư, tách Hunter prompt khỏi speech commit thành `prepareDiscussionViolation` và `finalizeDiscussionViolation`. Prepare trả `room.version`, cycle và pending hunters; finalize chỉ commit nếu các giá trị này còn khớp. Nếu room đã chuyển VOTING, prompt phải bị hủy/đóng và decision bị bỏ qua.

### P1 — cần xử lý trước canary ổn định

Tạo một per-room `discussionTransitionLock` hoặc persisted transition token dùng chung cho timer, speech và `startVoting`. Lock chỉ bảo vệ orchestration side effect; state CAS vẫn là authority. `presentVoting` phải idempotent theo `ballotId`, không gửi lại announcement nếu ballot đã được present.

Đưa event append vào outbox hoặc transaction boundary với state save. Nếu chưa thể thay đổi storage, tối thiểu thêm `commitVersion`/`sequence` vào event và retry append theo cùng version; event consumer phải deduplicate theo event ID.

Thêm structured log tại mọi boundary với các trường: `roomId`, `matchId`, `roomVersionBefore`, `roomVersionAfter`, `gameStateBefore`, `gameStateAfter`, `discussionCycleId`, `ballotId`, `speechEventId`, `actionId`, `source`, `outcome`, `retryAttempt` và `latencyMs`.

### P2 — observability và UX

Tách metric `speech_attempt`, `speech_blocked`, `speech_accepted`, `speech_stale`, `vote_callback_accepted`, `vote_callback_stale`, `phase_transition_conflict`, `timer_stale` và `event_append_retry`. Mỗi phase transition nên log một correlation ID dùng chung cho Telegram update, state mutation và presentation.

## 7. Test bổ sung bắt buộc

Cần thêm test timer-vs-speech với ba thứ tự: timer thắng, speech thắng và hai bên đọc cùng snapshot. Cần chạy mỗi thứ tự tối thiểu 1.000 iterations với fake clock và delayed storage adapter.

Cần thêm test Hunter prompt stale: prompt bị delay, room chuyển VOTING, decision đến sau; kỳ vọng không có Hunter death phụ, không có duplicate phase event và prompt được đóng.

Cần thêm test stale ballot token sau restart và sau round rollover. Callback cũ phải trả `STALE_BALLOT`, không tạo `VOTE_CAST`.

Cần thêm test event ordering khi `saveRoom` thành công nhưng `appendEvents` delay/fail; kỳ vọng outbox/retry không mất `SPEECH_VIOLATION`, `PLAYER_DIED`, `PHASE_CHANGED` hoặc `VOTE_CAST`.

Cần thêm test `allNightActionsSubmitted` với Silent Mage chưa submit; kỳ vọng night không advance sớm.

## 8. Kết luận readiness

**Domain-level speech-vote concurrency:** đạt mức tốt trong test adapter; không thấy double death hoặc state double-commit.

**Application-level runtime race:** chưa đạt production-ready. R2, R4, R6, R9 và R10 là các blocker ưu tiên. R7 cần được xử lý nếu event log dùng cho replay/audit nghiêm ngặt.

**Khuyến nghị:** không bật canary thật cho Silent Mage cho đến khi xử lý tối thiểu bốn P0: timer lifecycle/generation guard, ballot token, Hunter prepare/finalize guard và `roleHasNightAction` cho Silent Mage. Sau đó chạy mixed concurrency 1.000 iterations, restart/resume với Redis thật và kiểm tra structured logs trong Telegram canary.
