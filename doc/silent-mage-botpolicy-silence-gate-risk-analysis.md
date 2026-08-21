# Phân tích rủi ro realtime giữa BotPolicy và Silence Gate

**Phạm vi:** BotPolicy simulation, bot discussion scheduler, Silence Gate, discussion-death resolution, timer và callback vote.  
**Mục tiêu:** Xác định các edge-case có thể làm bot nói sai thời điểm, bỏ lọt hoặc tạo nhầm `SPOKEN_WHILE_SILENCED`, phát duplicate death, ghi telemetry sai hoặc làm lệch state sau race/retry/restart.  
**Trạng thái:** Phân tích thiết kế; không sửa source code và không tạo role.

---

## 1. Kết luận điều hành

Rủi ro lớn nhất không nằm ở hàm chọn câu thoại mà nằm ở **khoảng thời gian từ lúc BotPolicy chọn bot đến lúc Telegram message được gửi**, trong khi Silence Gate, room state, timer và death resolution có thể đã thay đổi. `BotPolicy` hiện chỉ có personality, belief, observation và target selection; chưa có `silenced`, `canSpeak` hoặc speech-attempt contract. [1] `scheduleBotDiscussion` hiện chỉ kiểm tra room còn ở `DISCUSSION` và bot còn sống, sau đó gửi message; chưa kiểm tra readiness, silence cycle, version, operation generation hay trạng thái stale ngay trước khi send. [2]

### 1.1. Mức độ rủi ro tổng thể

| Nhóm | Mức rủi ro | Tác động chính |
| --- | --- | --- |
| Gate/state race | **Rất cao** | Bot bị tính vi phạm trước announcement, hoặc gửi speech sau khi phase đã rời discussion. |
| Duplicate/retry | **Rất cao** | Một lần nói tạo nhiều `PLAYER_DIED`, Hunter chain hoặc `GAME_ENDED`. |
| Stale async callback | **Cao** | Nested timer dùng room/inspection cũ, gửi reaction sau death/game over hoặc sang cycle mới. |
| Silence persistence/cache | **Cao** | BotPolicy local state khác RoomState, câm nhầm ngày hoặc bỏ lọt enforcement. |
| Bot outbound boundary | **Cao** | Bot gửi qua Telegram nhưng không đi qua message middleware; test tưởng đã enforce nhưng engine không nhận speech event. |
| Vote isolation | **Trung bình** | Nếu gate đặt ở middleware chung, bot/player bị câm có thể bị chặn callback vote. |
| Telemetry | **Trung bình** | Observation ghi trước send/submit, dẫn đến metrics nói/vote không phản ánh outcome thật. |
| Randomness | **Trung bình** | Stress test không tái hiện được edge-case vì scheduler dùng `Math.random` ngoài RNG inject của BotPolicy. |

### 1.2. Nguyên tắc ưu tiên

> **RoomState và domain resolution là nguồn sự thật; BotPolicy chỉ là decision/simulation layer.** `canSpeak` của BotPolicy có thể tối ưu việc không gửi message, nhưng không được thay thế enforcement domain. Ngược lại, domain không được giả định rằng mọi bot outbound message đều đi qua Telegram message middleware.

---

## 2. Baseline contract cần áp dụng

Để phân tích có kết quả deterministic, dùng baseline sau:

| Contract | Quy tắc normative |
| --- | --- |
| Discussion cycle | Mỗi cycle có `matchId`, `currentRound`, `discussionCycleId`. Mọi bot callback phải mang cycle identity. |
| Gate lifecycle | `OPENING` = `ready=false`; `ACTIVE` = `ready=true`; `CLOSED` = không enforce. |
| Speech window | Chỉ `ACTIVE` và `now < silenceExpiresAt` mới có thể tạo violation. Dùng khoảng nửa mở `[activeAt, expiresAt)`. |
| Bot preflight | Bot chỉ được gửi normal speech khi `canSpeak` trả `ALLOW` tại thời điểm ngay trước khi send. `UNKNOWN` không được gửi normal speech. |
| Bot deliberate violation | Chỉ test mode mới được phép bypass preflight để tạo một `SPEECH_ATTEMPT`; không dùng trong gameplay mặc định. |
| Domain validation | Mọi speech attempt vẫn phải đi qua domain gate/re-read room/CAS; BotPolicy không tự kill player. |
| Idempotency | `speechEventId`/`attemptId` duy nhất cho một lần attempt; retry cùng id không tạo duplicate death. |
| Post-transition | Sau `CHECK_WIN → VOTING` hoặc `GAME_OVER`, mọi pending bot discussion callback trở thành no-op. |
| Vote | Silence không chặn callback vote; vote callback không tạo `SPEECH_ATTEMPT`. |
| Telemetry | Tách `SPEECH_ATTEMPT`, `SPEECH_ALLOWED`, `SPEECH_BLOCKED`, `SPEECH_REJECTED`, `MESSAGE_DELIVERY_FAILED` và `VOTE_ATTEMPT` thay vì ghi chung `DISCUSSION`/`VOTE`. |

---

# Phần I — Edge-case realtime chi tiết

## 3. Edge-case theo lifecycle và timing

### R1 — Bot callback chạy trong `OPENING` trước khi announcement hoàn tất

**Kịch bản:** `DayService.startDiscussion` đã persist `DISCUSSION`; `GameFlowController` đang chờ `sendMessage`; một bot timer đã được schedule hoặc callback cũ đang chạy. Bot chọn nói trong khoảng này.

**Rủi ro:** Nếu BotPolicy chỉ nhìn `gameState === DISCUSSION`, bot có thể phát speech trước khi người chơi nhận announcement. Nếu synthetic bot event đi thẳng domain mà không kiểm tra readiness, bot có thể chết sai.

**Mức:** P0.  
**Mitigation:** `canSpeak` phải nhận lifecycle; normal bot chỉ được gửi khi `ACTIVE`. Trong `OPENING`, normal bot không gửi hoặc chỉ gửi system/test event không phải speech. Domain vẫn reject `SPEECH_ATTEMPT` với reason `NOT_READY`.  
**Test:** `OPENING + delay Telegram send + bot timer` phải có zero death, zero Hunter prompt và zero `SPEECH_VIOLATION`.

### R2 — Gate được bật sau khi bot đã đọc room nhưng trước khi send

**Kịch bản:** Bot callback đọc snapshot `ready=false`, chọn câu thoại; ngay sau đó activation CAS bật `ready=true`; callback tiếp tục send.

**Rủi ro:** Bot message được gửi trong active window dù preflight đã dùng snapshot cũ. Nếu bot là deliberate violation, event timestamp và delivery timestamp có thể bị hiểu nhầm.

**Mức:** P1.  
**Mitigation:** Không coi một lần đọc room ở đầu callback là đủ. Trước khi send, re-read hoặc gọi `canSpeak` với `discussionCycleId`/version hiện tại. Với normal bot, chỉ `ALLOW` mới send. Với deliberate violation, attempt identity được tạo tại thời điểm test chủ động yêu cầu, domain quyết định theo current state.

### R3 — Gate đóng khi message đang in-flight

**Kịch bản:** Bot đã gọi `sendMessage`; trong lúc Telegram request đang pending, player chết, room chuyển `VOTING` hoặc `GAME_OVER`.

**Rủi ro:** Không thể reliably thu hồi request đã gửi. Message có thể xuất hiện sau phase transition. Nếu code xử lý violation sau delivery, bot đã chết trước khi event được commit; nếu xử lý trước delivery, message nhìn thấy có thể xuất hiện dù actor đã chết.

**Mức:** P1.  
**Mitigation:** Preflight ngay trước send là lớp bảo vệ chính; sau khi request bắt đầu, coi attempt identity là đã được tạo và xử lý domain theo policy nhất quán. Không dùng Telegram delivery timestamp để quyết định phase. Nếu send thất bại, ghi `MESSAGE_DELIVERY_FAILED`; không tạo thêm attempt khi retry cùng id. Với gameplay normal, chỉ gửi khi `ALLOW`; với deliberate test mode, chấp nhận đây là limitation của outbound simulation và assert domain idempotency.

### R4 — Discussion timeout và bot speech cùng thời điểm

**Kịch bản:** Timer callback đọc `DISCUSSION`, bot callback cũng đọc `DISCUSSION`; timer chuyển sang `VOTING` trước khi bot save/attempt.

**Rủi ro:** Bot gửi discussion message muộn, hoặc speech operation cố `DISCUSSION → CHECK_WIN` khi room đã `VOTING`; nếu thiếu phase re-check sẽ tạo invalid transition.

**Mức:** P0.  
**Mitigation:** Cả bot send path và domain speech resolver phải re-read state. Timer transition và death resolution dùng CAS. Pending bot callback sau `VOTING` phải no-op. Scheduler handler hiện có re-check gameState nhưng bot callback cũng phải có guard tương đương ngay trước send. [2]

### R5 — Discussion death chuyển sang `VOTING` nhưng nested reaction timer vẫn chạy

**Kịch bản:** `scheduleBotDiscussion` tạo nested `setTimeout(..., 2000)` để bot reaction. Trong 2 giây đó, speech violation làm room chuyển `CHECK_WIN → VOTING` hoặc `GAME_OVER`.

**Rủi ro:** Code hiện chỉ kiểm tra `nextRoom.gameState === DISCUSSION`; nếu state đã đổi thì return là đúng, nhưng nếu room state đọc trước transition rồi transition xảy ra ngay sau check, reaction vẫn có thể gửi. Ngoài ra inspection và target nickname có thể thuộc cycle cũ. [2]

**Mức:** P0/P1.  
**Mitigation:** Dùng `discussionCycleId`/generation token trong callback; kiểm tra phase, lifecycle, round, cycle và speaker alive ngay trước send. Tốt hơn, quản lý timer handle theo room/cycle để cancel khi resolution bắt đầu; guard vẫn bắt buộc vì cancel không đảm bảo thu hồi callback đã chạy.

### R6 — Bot được chọn sống nhưng chết trước khi send

**Kịch bản:** `aliveBots` được tạo từ snapshot; người đó bị Hunter hoặc speech death xử lý trước `sendMessage`.

**Rủi ro:** Bot chết vẫn gửi speech, tạo observation hoặc trigger violation lần thứ hai.

**Mức:** P0.  
**Mitigation:** Re-read player trước send; domain luôn kiểm tra alive. `canSpeak` phải trả `DENY` cho dead. Nếu callback đã tạo attempt nhưng CAS thấy dead, result là `PLAYER_ALREADY_DEAD`, không có death event. Bot-side observation phải ghi `SPEECH_REJECTED`, không ghi `SPEECH_ALLOWED`.

### R7 — Bot bị silence sau khi callback đã chọn câu thoại

**Kịch bản:** Silent Mage action/night resolution hoặc administrative state update áp silence vào bot sau khi callback đã chọn random bot nhưng trước khi gửi.

**Rủi ro:** Bot gửi normal speech dù local policy chưa biết target đã bị câm. Nếu outbound bot bypass middleware, không có lớp chặn thứ hai.

**Mức:** P0.  
**Mitigation:** `canSpeak` phải lấy active silence từ persisted room snapshot ngay trước send. BotPolicy local cache chỉ là hint; không được dùng làm authority. Khi transition áp silence, invalidate bot scheduler generation hoặc cập nhật policy event đồng bộ.

### R8 — Silence hết hạn đúng tại boundary

**Kịch bản:** Bot attempt ở `now === silenceExpiresAt` hoặc clock của BotPolicy và storage lệch vài milliseconds.

**Rủi ro:** Có node coi bot còn câm, node khác coi hết câm; test flaky; violation không deterministic.

**Mức:** P1.  
**Mitigation:** Dùng server-side clock/storage clock; định nghĩa rõ khoảng nửa mở: active nếu `now >= activeAt && now < expiresAt`; tại `now === expiresAt` là hết câm. Không dùng Telegram/client timestamp. Test fake clock tại `expiresAt - 1`, `expiresAt`, `expiresAt + 1`.

### R9 — Bot normal và deliberate-violation mode chạy đồng thời

**Kịch bản:** Một scheduled normal callback và một test command đặt deliberate violation cho cùng bot/cycle cùng lúc.

**Rủi ro:** Hai speech attempts, hai `speechEventId`, duplicate death hoặc test không biết attempt nào là expected.

**Mức:** P1.  
**Mitigation:** Deliberate violation phải là one-shot lease theo `botId + cycle`, có `attemptId` duy nhất và consume atomic. Normal scheduler thấy lease/resolution pending thì skip. Test fixture phải assert đúng một attempt.

### R10 — Nhiều bot timer chọn cùng một bot hoặc cùng cycle

**Kịch bản:** `scheduleBotDiscussion` được gọi hai lần do retry/startup resume; mỗi callback chọn cùng bot.

**Rủi ro:** Duplicate message, duplicate observation, một bot bị xử lý hai lần; BotPolicy state bị mutate không theo thứ tự.

**Mức:** P1.  
**Mitigation:** Schedule key deterministic `roomId + matchId + discussionCycleId + botTurnId`; scheduler idempotency và per-cycle bot turn claim. Không dựa chỉ vào `setTimeout` in-memory. Domain event idempotency vẫn là lớp cuối.

## 4. Edge-case theo state consistency và cache

### R11 — BotPolicy state tồn tại theo `roomId` nhưng match mới dùng lại room

**Kịch bản:** Room kết thúc, `clearRoom` xóa map; callback cũ hoặc match mới cùng roomId gọi `getState`, tự tạo state mới. Hoặc `clearRoom` chưa chạy khi match mới bắt đầu, beliefs/observations cũ còn sót.

**Rủi ro:** Bot tin rằng target cũ vẫn là Sói, silence cũ được áp nhầm, telemetry trộn hai match.

**Mức:** P1.  
**Mitigation:** Key state theo `matchId` hoặc `roomId + matchId`, không chỉ `roomId`. Mọi BotPolicy API nhận cycle identity. Callback cũ có generation mismatch thì no-op. `clearRoom` phải ghi completed telemetry theo match, không ghi đè match khác.

### R12 — BotPolicy local state nói `canSpeak=true`, RoomState nói `silenced=true`

**Kịch bản:** Silence effect được persist nhưng event update cho BotPolicy bị trễ/mất.

**Rủi ro:** Bot gửi speech; vì bot outbound không đi qua message middleware, domain có thể không nhận event hoặc nhận muộn.

**Mức:** P0.  
**Mitigation:** `RoomState` là authority. `canSpeak` không được trả `ALLOW` nếu cache chưa xác nhận cùng version/cycle. Tri-state result nên là `ALLOW | DENY | UNKNOWN`; normal bot chỉ send ở `ALLOW`. Nếu storage unavailable, fail closed cho normal speech. Deliberate test mode phải explicit và không đại diện gameplay.

### R13 — RoomState nói active nhưng BotPolicy local nói đã hết silence

**Kịch bản:** BotPolicy tự tính expiry theo timer local, trong khi server persist expiry khác hoặc process clock lệch.

**Rủi ro:** Bỏ lọt violation hoặc behavior khác nhau giữa bot instances.

**Mức:** P1.  
**Mitigation:** Không để BotPolicy tự quyết expiry; `canSpeak` tính từ room snapshot và server clock. Local timer chỉ dùng để tối ưu bỏ qua check, không được mở quyền send sớm.

### R14 — Public silence announcement đến sau bot scheduler

**Kịch bản:** Night finalize đã tạo silence effect, nhưng public day announcement hoặc silence announcement đang gửi chậm; bot scheduler bắt đầu vì room đã `DISCUSSION`.

**Rủi ro:** Bot biết/không biết mình câm không nhất quán; enforcement có thể active sai thời điểm.

**Mức:** P0.  
**Mitigation:** Không schedule bot discussion trước `ACTIVE`. Public announcement success và active silence projection phải hoàn tất trước bot normal scheduler. Nếu announcement failure, bot không được nói normal; recovery giữ `OPENING`.

### R15 — `consumeLastInspection` bị consume bởi callback stale

**Kịch bản:** Seer inspection của cycle cũ vẫn nằm trong `BotPolicy.lastInspectResult`; timer mới consume nó sau restart hoặc phase transition.

**Rủi ro:** Bot claim/accuse trong cycle sai, target nickname/round sai, scheduled reaction dùng dữ liệu cũ.

**Mức:** P1.  
**Mitigation:** Inspection result phải chứa `matchId`, `round`, `discussionCycleId`, `expiresAt`; consume chỉ khi identity khớp room hiện tại. Không dùng một field `lastInspectResult` global theo room nếu có thể có callback chồng lấn.

### R16 — `clearRoom` xảy ra nhưng async callback ghi telemetry lại

**Kịch bản:** `announceGameOver` gọi `botPolicy.clearRoom`; một callback đã qua room check trước đó tiếp tục `recordObservation` sau clear.

**Rủi ro:** Ghost state được tạo lại, completed telemetry không còn là snapshot cuối, memory leak và observation sau game over.

**Mức:** P1.  
**Mitigation:** `clearRoom` tăng generation/closed marker; `recordObservation` yêu cầu matching match/cycle generation. Sau `CLOSED`, callback phải no-op. Không để `getState(roomId)` tự khởi tạo state trong callback stale.

## 5. Edge-case theo event, delivery và telemetry

### R17 — Ghi observation trước khi Telegram send nhưng send thất bại

**Kịch bản:** `recordObservation(DISCUSSION)` chạy trước `sendMessage`; Telegram timeout/failure.

**Rủi ro:** Telemetry đếm bot đã nói dù group không nhận message; test vote/discussion count sai; retry có thể ghi thêm observation.

**Mức:** P1.  
**Mitigation:** Tách `SPEECH_ATTEMPT` khỏi `MESSAGE_DELIVERED` và `MESSAGE_DELIVERY_FAILED`. Mỗi attempt có `attemptId`; retry cùng attempt cập nhật outcome, không append speech mới. Nếu gameplay domain coi “attempt to speak” là vi phạm, death decision dựa trên attempt acceptance, còn delivery chỉ là telemetry.

### R18 — Xử lý domain violation trước send làm bot chết nhưng message vẫn được gửi

**Kịch bản:** Deliberate test mode gọi domain speech resolver trước; resolver kill bot; sau đó code vẫn gọi Telegram send.

**Rủi ro:** Group nhìn thấy người đã chết nói sau khi death event; UX khó hiểu, test E2E race phụ thuộc latency.

**Mức:** P1, chủ yếu test/simulation.  
**Mitigation:** Normal bot không gửi nếu `DENY`. Với deliberate violation, dùng synthetic speech event/telemetry không nhất thiết gửi message thật; nếu cần hiển thị, ghi rõ test-only. Không dùng outbound Telegram message làm trigger duy nhất vì bot message có thể không quay về middleware.

### R19 — Retry Telegram send tạo hai message nhưng một speechEventId

**Kịch bản:** Send timeout, retry gửi lại; Telegram thực tế đã nhận request lần đầu.

**Rủi ro:** Hai message xuất hiện; middleware hoặc simulator tạo hai update/event; domain phải xử lý cùng event id hoặc hai message id khác nhau.

**Mức:** P1.  
**Mitigation:** Dùng deterministic outgoing message key/idempotency nếu gateway hỗ trợ; nếu không, retry notification phải tách khỏi domain speech attempt. Domain attempt chỉ tạo một lần trước retry. Metric duplicate delivery phải được ghi.

### R20 — Bot observation và domain event khác round

**Kịch bản:** Bot callback lấy `room.currentRound = 1`, chờ async; phase chuyển sang round 2, callback ghi observation round 1 nhưng message/event xử lý trong round 2.

**Rủi ro:** Belief update, telemetry và audit log không khớp; stress analysis kết luận sai.

**Mức:** P1.  
**Mitigation:** Không lấy round từ closure cũ tại lúc send; re-read và tạo `attempt` metadata từ snapshot hiện tại. Nếu cycle mismatch, discard stale callback. Observation phải chứa `matchId`, `round`, cycle và source version.

### R21 — Event publish delay làm BotPolicy tin death chưa xảy ra

**Kịch bản:** Domain room save đã kill bot nhưng event bus update BotPolicy chưa publish; scheduler callback đọc BotPolicy cũ và chọn bot chết.

**Rủi ro:** Bot outbound message sau death hoặc stale belief.

**Mức:** P0/P1.  
**Mitigation:** Bot scheduler re-read RoomState và check alive ngay trước send; không chờ BotPolicy event để xác nhận alive. Event bus chỉ dùng để invalidate cache/telemetry, không phải authority.

### R22 — Observation retention 200 làm mất evidence của violation

**Kịch bản:** Nhiều discussion/vote events làm `observationsByRoom` chỉ giữ 200 entries; `SPEECH_ATTEMPT` hoặc `SPEECH_REJECTED` cũ bị drop trước khi test/diagnostic đọc.

**Rủi ro:** Không truy nguyên được vì sao bot chết hoặc vì sao message bị block.

**Mức:** P2 nhưng cao trong stress.  
**Mitigation:** Tách operational event log khỏi rolling BotPolicy telemetry. Rolling window có thể giữ 200, nhưng `SPEECH_ATTEMPT`, `SPEECH_VIOLATION`, death correlation và gate transitions phải append vào audit/event log bền vững hoặc counter theo cycle.

## 6. Edge-case về callback vote và phase boundary

### R23 — Silence Gate đặt ở middleware chung chặn callback vote

**Kịch bản:** Developer thêm `if (player.silenced) return` ở middleware trước khi phân biệt `ctx.message` và `ctx.callbackQuery`.

**Rủi ro:** Người bị câm không thể vote, vi phạm contract role và làm game bias.

**Mức:** P0.  
**Mitigation:** Gate chỉ áp `ctx.message` speech trong group; callback query đi handler riêng. Integration test phải assert silenced alive bot/player vote thành công. Hiện `src/index.ts` đã phân nhánh `ctx.message`, còn `actionCallbackHandler` đăng ký `callback_query` riêng; boundary này cần regression lock. [3] [4]

### R24 — Bot bắt đầu vote từ snapshot trước khi discussion death hoàn tất

**Kịch bản:** `startVoting` dựng `aliveTargets` từ room snapshot, sau đó discussion death finalize làm thêm player chết hoặc game over.

**Rủi ro:** Keyboard có target chết, BotPolicy chọn invalid target, submit vote fail; telemetry ghi vote dù không cast.

**Mức:** P1.  
**Mitigation:** `startVoting` chỉ chạy sau final room commit; dựng targets từ snapshot mới. Mỗi `submitVote` vẫn validate target sống. Bot observation tách `VOTE_ATTEMPT` và `VOTE_CAST`. Nếu invalid do race, ghi rejected reason chứ không coi là vote accepted.

### R25 — Silence Gate nhận `/vote` như speech vì chỉ dựa trên text prefix

**Kịch bản:** Middleware nhìn mọi `ctx.message.text` là speech trước khi command router xử lý.

**Rủi ro:** Người bị câm dùng `/vote` bị chết hoặc command bị delete, trái với contract callback/command exclusion.

**Mức:** P0.  
**Mitigation:** Classifier phải phân loại command trước speech; `/vote` là control action, không phải speech. Đặc tả cần test `/vote`, `/status`, `/end` và command có bot suffix/arguments.

### R26 — Bot chat callback chạy sau `/end` hoặc room close

**Kịch bản:** Host kết thúc room, BotPolicy clear/unmute; pending bot timer vẫn chạy.

**Rủi ro:** Bot gửi message vào room đã đóng hoặc tự khởi tạo policy state mới.

**Mức:** P1.  
**Mitigation:** Re-read `RoomStatus` và `GameState`, generation guard, cancel handles best-effort; stale callback no-op. `GAME_OVER` và `CLOSED` phải là terminal cho bot scheduler.

---

# Phần II — Risk matrix và invariant

## 7. Ma trận ưu tiên xử lý

| ID | Risk | Probability | Impact | Priority | Mitigation bắt buộc |
| --- | --- | ---: | ---: | --- | --- |
| R1 | Speech trong OPENING | Cao | Rất cao | P0 | `ready=false` default; domain reject. |
| R4 | Timeout vs speech | Cao | Rất cao | P0 | CAS + phase re-read ở cả timer và speech. |
| R5 | Nested reaction stale | Cao | Cao | P0 | cycle/generation guard + cancel handles. |
| R6/R7 | Bot chết/câm trước send | Cao | Rất cao | P0 | Re-read alive/silence ngay trước send. |
| R12 | Local cache divergence | Trung bình | Rất cao | P0 | RoomState authority; `UNKNOWN` fail closed. |
| R14 | Announcement/gate order | Cao | Cao | P0 | Không schedule normal bot trước ACTIVE. |
| R21 | Event delay vs alive state | Trung bình | Cao | P0 | Re-read RoomState; event chỉ invalidate cache. |
| R23/R25 | Vote/command bị gate | Trung bình | Rất cao | P0 | Message-only classifier; callback/command exclusion. |
| R2/R3 | In-flight send boundary | Trung bình | Cao | P1 | Preflight + attempt id + post-send outcome. |
| R8 | Expiry boundary | Trung bình | Cao | P1 | Server clock, half-open interval. |
| R9/R10 | Duplicate bot attempts | Trung bình | Cao | P1 | One-shot lease, deterministic schedule key. |
| R11/R15/R16/R20 | Stale room/cycle/policy state | Trung bình | Cao | P1 | match/cycle/generation identity. |
| R17/R19/R22 | Telemetry/delivery mismatch | Cao | Trung bình | P1/P2 | Separate attempt/delivery/audit event. |
| R24 | Stale vote targets | Trung bình | Cao | P1 | Rebuild after final commit + submit validation. |
| R26 | Callback after close | Thấp–trung bình | Cao | P1 | Terminal generation guard. |

## 8. Invariants phải được assert trong mọi runtime path

1. **No early enforcement:** Không có `PLAYER_DIED` với cause `SPOKEN_WHILE_SILENCED` khi lifecycle không phải `ACTIVE`.
2. **No stale cycle:** Mọi bot attempt mang `matchId`, `round` và `discussionCycleId` hiện tại.
3. **Room authority:** BotPolicy không được mở quyền nói dựa trên local cache nếu cache không xác nhận cùng room version/cycle.
4. **Single death:** Một `speechEventId` tạo tối đa một logical resolution và một death cho mỗi player.
5. **No dead speaker:** Player đã chết không tạo speech violation mới.
6. **No orphan silence:** Active silence chỉ trỏ tới player sống thuộc match hiện tại.
7. **Vote isolation:** `isSilenced` không ảnh hưởng callback vote của player còn sống.
8. **Terminal silence:** `GAME_OVER`/`CLOSED` đóng gate và làm mọi callback bot discussion thành no-op.
9. **Timer safety:** Timer stale không thể chuyển `GAME_OVER`, `VOTING` hoặc cycle khác sang phase mới.
10. **Telemetry truthfulness:** Observation `SPEECH_ATTEMPT` không được đồng nghĩa với `MESSAGE_DELIVERED` hoặc `SPEECH_VIOLATION`.
11. **Deterministic test:** Cùng seed, cùng event order và cùng fixture tạo cùng BotPolicy decision; production random không được rò vào unit test.
12. **No policy resurrection:** Callback stale sau `clearRoom` không được tự tạo lại BotPolicy state.

---

# Phần III — Thiết kế mitigation realtime

## 9. Preflight/attempt/finalize protocol cho BotPolicy

Một bot normal speech nên đi qua protocol ba bước:

### Bước A — Preflight

Bot scheduler đọc room mới nhất và tạo attempt context:

```text
{ matchId, round, discussionCycleId, roomVersion,
  botId, attemptId, messageKind, mode: NORMAL | DELIBERATE_TEST }
```

`canSpeak` trả:

| Kết quả | Normal mode | Deliberate test mode |
| --- | --- | --- |
| `ALLOW` | Được tiếp tục send | Được tiếp tục send/ingest. |
| `DENY` | Bỏ qua, ghi `SPEECH_BLOCKED` | Chỉ được tiếp tục nếu test fixture explicit. |
| `UNKNOWN` | Không send; ghi availability error | Không dùng để kết luận gameplay; test fail nếu không mock authority. |

### Bước B — Atomic attempt acceptance

Trước hoặc đồng thời với outbound simulation, domain resolver re-read room và kiểm tra phase/readiness/alive/silence/cycle. `attemptId` được dùng để idempotency. Nếu state stale, trả rejected mà không mutate.

### Bước C — Delivery/observation outcome

Telegram send, nếu cần, là side effect sau acceptance hoặc theo policy test đã chốt. Kết quả phải phân biệt:

```text
SPEECH_ATTEMPTED
SPEECH_ACCEPTED
SPEECH_BLOCKED
SPEECH_REJECTED_STALE
MESSAGE_DELIVERED
MESSAGE_DELIVERY_FAILED
PLAYER_DIED
```

Không dùng một `recordObservation(type='DISCUSSION')` để đại diện cho tất cả các trạng thái trên.

## 10. Generation guard

Mỗi room match/cycle có một generation token. Khi xảy ra một trong các sự kiện sau, generation tăng hoặc cycle bị đóng:

- announcement activation thất bại rồi bắt đầu retry cycle mới;
- discussion chuyển sang `VOTING`;
- discussion death bắt đầu resolution;
- room `GAME_OVER`/`CLOSED`;
- match mới bắt đầu với cùng room id.

Callback bot chỉ được tiếp tục nếu generation lúc callback chạy khớp generation hiện tại. Generation guard không thay thế CAS; nó giảm callback stale trước khi tới storage.

## 11. Bot timer policy

`setTimeout` hiện tại là best-effort và không đủ làm scheduler authority. Đề xuất:

1. Mỗi bot turn có deterministic key `matchId + cycleId + botId + turnIndex`.
2. Timer callback luôn re-read room ngay trước policy decision và ngay trước send.
3. Callback không gửi nếu state khác `DISCUSSION/ACTIVE` hoặc bot không còn alive.
4. Khi resolution bắt đầu, cancel pending handles best-effort và đóng generation.
5. Dù cancel thành công hay không, callback stale vẫn phải no-op bằng generation/state check.
6. Không chọn bot bằng `Math.random` trực tiếp trong orchestration nếu test cần reproducibility; inject RNG/seed từ BotPolicy.

## 12. Failure policy

| Tình trạng | Normal bot | Domain speech resolver | Telemetry |
| --- | --- | --- | --- |
| Room read timeout | Không send | Retry/fail closed | `POLICY_STATE_UNAVAILABLE`. |
| Gate unknown | Không send | Reject/defer, không kill | `SPEECH_BLOCKED_UNKNOWN`. |
| Bot dead | Không send | Reject | `SPEECH_REJECTED_DEAD`. |
| Silence active | Không send | Nếu attempt deliberate/real hợp lệ thì resolve death | `SPEECH_BLOCKED_SILENCED` hoặc `SPEECH_VIOLATION`. |
| Phase stale | Không send | No-op | `SPEECH_REJECTED_STALE`. |
| Telegram send fail | Không retry dưới attempt id mới | Domain result giữ nguyên; không rerun death | `MESSAGE_DELIVERY_FAILED`. |
| Scheduler duplicate | Một turn claim | Idempotency | `BOT_TURN_DUPLICATE`. |

---

# Phần IV — Test scenarios bổ sung

## 13. Realtime race tests

| ID | Scenario | Expected |
| --- | --- | --- |
| RT-BOT-001 | Bot callback during `OPENING` | Không gửi normal speech, không death, không Hunter. |
| RT-BOT-002 | Gate activates after first room read | Second preflight thấy active; result deterministic theo current snapshot. |
| RT-BOT-003 | Gate closes during send | Không duplicate resolution; delivery outcome tách khỏi domain result. |
| RT-BOT-004 | Discussion timeout wins CAS before bot attempt | Bot callback stale/no-op; không có discussion message sau phase. |
| RT-BOT-005 | Bot death wins before send | No send, no observation accepted, no second death. |
| RT-BOT-006 | Silence applied before send | Normal bot skip; deliberate test path only if explicitly armed. |
| RT-BOT-007 | Expiry at `expiresAt - 1/0/+1` | Chỉ `-1` active; `0` và `+1` expired. |
| RT-BOT-008 | Two normal callbacks same bot/cycle | One turn claim; one message maximum. |
| RT-BOT-009 | Normal + deliberate mode same cycle | Deliberate one-shot wins; normal callback skips. |
| RT-BOT-010 | Nested reaction after game over | No message, no recreated policy state. |
| RT-BOT-011 | Event bus delayed after room save | Scheduler re-read sees dead state; no stale speech. |
| RT-BOT-012 | Room reused for new match | Old callback generation rejected; new match policy isolated. |
| RT-BOT-013 | Storage unavailable in `canSpeak` | Normal bot fails closed; no silent bypass. |
| RT-BOT-014 | Duplicate scheduler job after restart | One deterministic turn; no duplicate event/death. |
| RT-BOT-015 | Same seed and event order | Same BotPolicy choice and observations. |

## 14. Telemetry correctness tests

| ID | Scenario | Expected |
| --- | --- | --- |
| RT-TEL-001 | Observation before send, send fails | Attempt + delivery failure; no delivered count. |
| RT-TEL-002 | Domain rejects stale attempt | Rejected stale; no discussion count that implies delivered speech. |
| RT-TEL-003 | Bot speech accepted and player dies | Attempt, violation, death correlated by attempt id. |
| RT-TEL-004 | Callback vote while silenced | `VOTE_ATTEMPT`/`VOTE_CAST`; zero speech observations. |
| RT-TEL-005 | `clearRoom` while callback pending | No observation after closed generation. |
| RT-TEL-006 | More than 200 observations | Rolling telemetry may truncate, audit violation remains durable. |
| RT-TEL-007 | Invalid bot vote due stale target | `VOTE_ATTEMPT` + rejected; not `VOTE_CAST`. |

## 15. Load/stress patterns

Stress test phải tạo contention có chủ ý thay vì chỉ chạy nhiều round tuần tự:

1. 10–20 bot callbacks trong cùng một discussion cycle.
2. 1–3 speech attempts cùng millisecond boundary với timeout.
3. 1 active silence expiry boundary mỗi cycle.
4. Random scheduler duplicate/restart injection.
5. Telegram send latency phân phối gồm fast, slow và failure.
6. Event bus delay sau commit.
7. Storage CAS conflict xác suất cố định.
8. Match reuse với callback stale từ match trước.

Metrics cần ghi theo cycle:

| Metric | Ý nghĩa |
| --- | --- |
| `bot_speech_attempt_total` | Số attempt tạo bởi BotPolicy. |
| `bot_speech_allowed_total` | Attempt qua preflight. |
| `bot_speech_blocked_total` | Bị gate chặn normal. |
| `bot_speech_rejected_stale_total` | Bị domain từ chối do phase/cycle/version. |
| `silent_mage_violation_total` | Violation được domain accept. |
| `bot_message_delivered_total` | Telegram/API delivery success. |
| `bot_message_delivery_failed_total` | Delivery failure. |
| `bot_turn_duplicate_total` | Duplicate scheduler/turn claim. |
| `stale_bot_callback_total` | Callback generation stale. |
| `silence_cache_mismatch_total` | Local policy khác persisted authority. |
| `vote_blocked_by_silence_total` | Phải luôn bằng 0. |

---

# Phần V — Khuyến nghị triển khai theo ưu tiên

## P0 — Phải xử lý trước khi chạy realtime E2E

1. Đưa `RoomState`/lifecycle/cycle/version vào `canSpeak` authority.
2. Thêm gate check cho bot scheduler, không chỉ message middleware.
3. Re-read phase/alive/silence/cycle ngay trước outbound bot send.
4. Thêm domain idempotency theo `speechEventId`/`attemptId`.
5. Đóng callback stale khi `VOTING`, `GAME_OVER`, `CLOSED` hoặc cycle đổi.
6. Giữ callback vote và command khỏi Silence Gate.
7. Chốt failure policy: normal bot fail closed khi room state unknown.

## P1 — Phải xử lý trước stress/restart sign-off

1. Generation guard và deterministic scheduler keys.
2. `SPEECH_ATTEMPT`/delivery/rejection telemetry tách biệt.
3. One-shot deliberate-violation lease.
4. Match-aware BotPolicy state, không key chỉ bằng room id.
5. Hunter pending-resolution marker để discussion timer không chạy song song.
6. Fake clock và server-time expiry boundary.
7. Restart/recovery tests cho opening, activation, death resolution và room reuse.

## P2 — Nên xử lý trước production hardening

1. Durable audit event ngoài rolling 200-observation window.
2. Dashboard metrics và alert thresholds.
3. Outbox/idempotent notification cho Telegram duplicate/failure.
4. Property-based/concurrency fuzz test cho phase/timer/order.
5. Monte Carlo balance analysis sau khi correctness đã ổn định.

## 16. Kết luận

BotPolicy không nên tự trở thành một “Silence Gate thứ hai”. Nếu BotPolicy và domain cùng quyết định độc lập bằng hai state khác nhau, hệ thống sẽ có split-brain: bot simulation nói một điều, RoomState và event log nói điều khác. Kiến trúc an toàn là **BotPolicy preflight để tối ưu**, **domain gate để quyết định**, **CAS/idempotency để commit**, và **telemetry để phân biệt attempt, delivery, violation và death**.

Các edge-case P0 cần được kiểm thử trước tiên là: bot trong `OPENING`, timeout cạnh speech, bot chết/câm giữa preflight và send, nested callback sau phase transition, local policy cache divergence, event delay, callback vote bị gate nhầm và duplicate scheduler job. Nếu các invariant trong mục 8 và RT test scenarios trong mục 13–14 pass, rủi ro realtime chính đã được cover trong phạm vi hiện tại.

## References

[1]: src/telegram/BotPolicy.ts "Bot personality, belief, observation, target selection và telemetry hiện tại"
[2]: src/telegram/GameFlowController.ts "startDiscussion, scheduleBotDiscussion, nested reaction và startVoting"
[3]: src/index.ts "Message middleware, group message gating và callback registration"
[4]: src/telegram/handlers/actionCallbackHandler.ts "Callback query vote/night action handler"
[5]: silent-mage-test-contract-and-plan.md "Baseline contract và unit/integration test plan"
[6]: silent-mage-technical-spec.md "Technical Specification state transition, readiness gate và recovery"
[7]: silent-mage-design-audit-v2.md "Audit vòng 2 BotPolicy, race condition và phương án A"
[8]: src/engine/DayService.ts "Optimistic locking, vote submission và resolution template"
[9]: src/engine/RoomTimerService.ts "Persisted deadline, cancellation và overdue recovery"
[10]: src/engine/domain/Room.ts "RoomState, version và GameSettings"
