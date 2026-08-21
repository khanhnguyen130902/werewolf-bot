# Technical Specification — Silent Mage

**Tài liệu:** Đặc tả kỹ thuật cho role “Pháp sư câm / Silent Mage”  
**Phiên bản:** 1.0 — Draft triển khai  
**Trạng thái:** Ready for implementation planning; **chưa được phép merge production**  
**Phạm vi:** State transition `DISCUSSION → CHECK_WIN`, xử lý death giữa discussion, race condition của announcement đầu ngày và tiêu chí sẵn sàng triển khai  
**Stack liên quan:** TypeScript/Node.js, Telegraf, Redis storage, BullMQ scheduler/timer, Jest  
**Nguyên tắc:** Tài liệu này chỉ đặc tả. Không tạo role, không sửa `RoleRegistry`, không thay đổi source code trong quá trình soạn tài liệu.

---

## 1. Mục tiêu và phạm vi

Silent Mage có một năng lực ban đêm: chọn một người chơi còn sống để áp trạng thái **silenced** cho ngày tiếp theo. Người bị câm không được gửi nội dung “nói” trong group discussion; callback vote và các thao tác không phải speech vẫn được phép. Nếu người bị câm gửi speech message trong thời gian enforcement đang active, hành vi đó tạo death cause `SPOKEN_WHILE_SILENCED` và có thể kích hoạt Hunter tùy theo cấu hình room.

Đặc tả này tập trung vào hai vấn đề mà audit đã xác định là có ảnh hưởng trực tiếp đến tính toàn vẹn của engine:

| Khu vực | Mục tiêu kỹ thuật |
| --- | --- |
| **Discussion death** | Death phát sinh từ speech violation phải được xử lý atomic, kiểm tra win condition ngay và không tạo “game over ẩn” bên trong room vẫn mang state `DISCUSSION`. |
| **Day announcement race** | Không bắt đầu speech enforcement trước khi announcement công khai đầu ngày đã được Telegram API chấp nhận thành công. |
| **Readiness** | Xác định rõ tiêu chí, test plan, rollout gate và các giới hạn trước khi bật role trong production. |

Các quyết định luật chơi khác của Silent Mage, chẳng hạn self-target, repeat-target, thứ tự `SILENT_MAGE_SILENCE` trong `nightActionOrder`, persistence của silence và Hunter trigger policy, được coi là dependency của đặc tả này. Chúng phải được chốt trước khi implementation bắt đầu; tài liệu này không tự động thay đổi các quyết định đó.

> **Nguyên tắc nguồn sự thật:** `GameStateMachine` là nguồn sự thật duy nhất cho các phase transition; `WinConditionChecker` là pure function để đánh giá thắng/thua; storage version là cơ chế optimistic locking; Telegram/BullMQ chỉ là orchestration boundary, không được tự quyết định domain state.

## 2. Baseline hiện tại và các điểm cần mở rộng

State machine hiện tại cho phép `DAY → DISCUSSION → VOTING → EXECUTION → CHECK_WIN`, và `CHECK_WIN → NIGHT | GAME_OVER`. `DISCUSSION` hiện chỉ có một successor trực tiếp là `VOTING`; vì vậy discussion death không thể gọi `DISCUSSION → CHECK_WIN` nếu chưa mở rộng transition table. [1]

`DayService::finalizeExecutionResolution` là template gần nhất cho flow mới: service lấy room bằng optimistic retry, áp dụng death trên bản sao player map, phát `PLAYER_DIED`, chuyển qua `EXECUTION → CHECK_WIN`, chạy `WinConditionChecker` trên room sau death, sau đó chuyển sang `GAME_OVER` hoặc phase tiếp theo và persist toàn bộ thay đổi theo version cũ. [2]

`GameFlowController::startDiscussion` hiện gọi `DayService::startDiscussion` trước khi `sendMessage(Messages.discussionStarted(...))` hoàn tất. Như vậy room có thể đã được persist với `gameState = DISCUSSION` trong khi announcement chưa được Telegram API chấp nhận. [3] `src/index.ts` cũng có startup resume logic coi room `DISCUSSION` là room có thể chuyển sang voting khi timer overdue; logic này là lý do không được giữ một match đã thắng ở state `DISCUSSION`. [4]

| Thành phần | Hành vi hiện tại | Hệ quả cho Silent Mage |
| --- | --- | --- |
| `GameStateMachine` | `DISCUSSION → VOTING`; chưa có `DISCUSSION → CHECK_WIN` | Phải mở rộng transition contract theo phương án A. |
| `DayService` | Có `withRetry`, `saveRoom(room, room.version)`, event append/publish và post-death win check | Dùng làm mẫu cho atomic discussion-death service. |
| `WinConditionChecker` | Đếm player sống; village thắng khi không còn Sói; Sói thắng khi `aliveWerewolves >= aliveVillagers` | Phải chạy sau khi death đã được áp dụng. |
| `GameFlowController` | Gửi announcement và schedule timer qua các lời gọi async | Cần readiness gate, CAS và retry/recovery. |
| `src/index.ts` | Message middleware chỉ xử lý `ctx.message`; callback handler riêng xử lý vote | Enforcement phải giữ nguyên ranh giới này. |
| `RoomTimerService`/BullMQ | Deadline được persist và job có thể được redeliver/resume | Timer stale phải tự kiểm tra phase, readiness và round. |

## 3. Thuật ngữ và invariant

### 3.1. Thuật ngữ

| Thuật ngữ | Định nghĩa bắt buộc |
| --- | --- |
| **Discussion death** | Death xảy ra trong `GameState.DISCUSSION`, điển hình là `SPOKEN_WHILE_SILENCED`, không phải kết quả vote execution. |
| **Active enforcement** | Thời điểm room đã có announcement thành công và gate speech đã bật. Chỉ từ thời điểm này speech handler mới được đánh giá violation. |
| **Opening transaction** | Hai bước domain/orchestration: persist room ở trạng thái `DISCUSSION` nhưng enforcement chưa sẵn sàng; gửi announcement; sau đó CAS activate enforcement. |
| **Target effect** | Silence effect áp lên người được Silent Mage chọn. Effect được lọc theo alive state sau night finalization. |
| **Caster action finality** | Night action đã submit hợp lệ trước khi caster chết vẫn được resolve; caster không cần sống ở cuối night. Đây là pattern hiện tại của các action Seer/Witch. [5] |
| **CAS** | Compare-and-set thông qua optimistic version: chỉ ghi được nếu room vẫn có `version` mà caller đã đọc. |

### 3.2. Invariant bắt buộc

1. Không có đường code nào được set `gameState = GAME_OVER` trực tiếp nếu chưa đi qua `GameStateMachine.assertTransition`.
2. Một discussion death chỉ được commit một lần theo `actionId`/`eventId` hoặc transaction key; retry không được giết lại player hoặc phát duplicate terminal events.
3. `WinConditionChecker` luôn chạy trên room snapshot đã áp dụng toàn bộ death của operation hiện tại.
4. `activeSilencedIds` luôn là tập con của các player còn sống và thuộc match hiện tại.
5. `discussionEnforcementReady = false` nghĩa là speech message không được coi là violation, bất kể room đã có `gameState = DISCUSSION`.
6. Người còn sống nhưng đang silenced vẫn được callback vote khi room ở `VOTING`; silence không được chặn callback query.
7. Mọi timer callback phải re-read room và kiểm tra phase, round, readiness/lifecycle và terminal state trước khi mutating.
8. Event log append và room snapshot phải phản ánh cùng một logical operation; event publish failure không được làm rollback một snapshot đã commit, nhưng phải có retry/telemetry.

---

# Phần I — Technical Specification cho `DISCUSSION → CHECK_WIN`

## 4. Quyết định kiến trúc

Chọn **phương án A**: thêm đường transition chính thức từ `DISCUSSION` qua `CHECK_WIN`. Tuy nhiên, phương án A phải được triển khai đầy đủ với nhánh terminal và non-terminal; chỉ thêm một cạnh `DISCUSSION → CHECK_WIN` là chưa đủ.

### 4.1. Transition graph bắt buộc

```text
DISCUSSION ──(discussion death)──> CHECK_WIN
CHECK_WIN ──(winner != NONE)─────> GAME_OVER
CHECK_WIN ──(winner == NONE)─────> DISCUSSION hoặc VOTING
DISCUSSION ──(discussion timeout bình thường)──> VOTING
```

Contract sản phẩm phải chọn một trong hai hành vi sau khi death nhưng chưa kết thúc game:

| Mode | Transition sau `CHECK_WIN` | Khi dùng | Tác động |
| --- | --- | --- | --- |
| **Continue discussion** | `CHECK_WIN → DISCUSSION` | Muốn người chơi tiếp tục tranh luận sau khi một người chết | Cần reset/giữ đúng discussion deadline và không tạo opening announcement mới. |
| **Close discussion and vote** | `CHECK_WIN → VOTING` | Muốn death kết thúc ngay phần discussion hiện tại | Cần gửi announcement death, dựng ballot keyboard và schedule voting timer. |

**Khuyến nghị mặc định:** dùng `CHECK_WIN → VOTING` nếu discussion death là một event đủ nghiêm trọng để kết thúc speech window; dùng `CHECK_WIN → DISCUSSION` chỉ khi product owner muốn giữ discussion tiếp tục. Trong cả hai trường hợp, không dùng `CHECK_WIN → NIGHT` vì sẽ bỏ qua ballot của ngày hiện tại khi game chưa thắng. Audit vòng 2 đã xác định đây là rủi ro quan trọng của việc thêm transition không đầy đủ. [6]

### 4.2. Điều kiện kích hoạt

Operation `resolveDiscussionDeath` chỉ được phép bắt đầu khi tất cả điều kiện sau đúng:

| Điều kiện | Yêu cầu |
| --- | --- |
| Room tồn tại | `RoomState` được đọc từ storage theo `roomId`. Nếu không tồn tại, trả `RoomNotFoundError`. |
| Đúng phase | `room.gameState === GameState.DISCUSSION`. Nếu đã sang `VOTING`, `CHECK_WIN` hoặc `GAME_OVER`, không được áp discussion death từ operation cũ. |
| Enforcement active | `discussionEnforcementReady === true`. Speech trước thời điểm này không phải violation. |
| Speaker tồn tại | `room.players[speakerTelegramId]` tồn tại và thuộc room. |
| Speaker còn sống | Chỉ player sống mới có thể chết từ speech violation. Message của dead player phải bị xử lý theo mute/dead-message policy, không tạo death mới. |
| Speech là loại được định nghĩa | Text, voice, sticker, GIF hoặc loại message được product contract coi là “nói”. Callback query, vote callback và các command không thuộc nhóm speech. |
| Speaker đang silenced | Silence effect phải active cho `currentRound`/discussion cycle. Nếu đã hết hạn hoặc không có effect, không tạo death. |
| Action chưa xử lý | `speechEventId`/`actionId` chưa được ghi nhận là processed. Đây là idempotency guard bắt buộc. |

Nếu Hunter trigger được bật cho `SPOKEN_WHILE_SILENCED`, operation tiếp tục vào DeathQueue theo policy Hunter. Nếu trigger bị tắt, chỉ speaker là depth-0 death và không có Hunter chain.

### 4.3. Input contract

Đây là logical contract, không phải code signature bắt buộc. Tên field có thể điều chỉnh khi implementation, nhưng semantics không được thay đổi.

```text
ResolveDiscussionDeathInput {
  roomId: string
  speechEventId: string       // Telegram update/message identity, idempotency key
  speakerTelegramId: string
  chatId: string
  messageKind: TEXT | VOICE | STICKER | GIF | OTHER_SPEECH
  receivedAt: number
  enforcementCycleId: string
}
```

Validation phải xác minh `chatId` khớp room binding, `enforcementCycleId` khớp discussion cycle hiện tại nếu field này được persist, và `speechEventId` chưa xử lý. Không được tin `chatId`, player state hoặc silence status lấy riêng từ Telegram update nếu không đối chiếu room snapshot.

### 4.4. Output contract

Operation trả về một kết quả immutable cho application layer:

```text
ResolveDiscussionDeathResult {
  room: RoomState
  accepted: boolean
  ignoredReason?:
    STALE_PHASE |
    NOT_READY |
    NOT_SILENCED |
    PLAYER_ALREADY_DEAD |
    DUPLICATE_EVENT |
    INVALID_MESSAGE_KIND
  deaths: Array<{ telegramId: string; cause: DeathCause }>
  winner: WinnerTeam
  nextState: GameState
  events: DomainEvent[]
  timerAction: CANCEL_DISCUSSION | START_DISCUSSION | START_VOTING | NONE
}
```

Nếu `accepted = false`, operation không được phát `PLAYER_DIED`, `WIN_CONDITION_MET` hoặc `GAME_ENDED`. Nếu operation nhận duplicate event sau khi commit, nên trả kết quả idempotent đã lưu hoặc `DUPLICATE_EVENT` mà không tạo side effect mới.

### 4.5. State mutation và event contract

Room mutation tối thiểu gồm:

| Field | Mutation |
| --- | --- |
| `players[speaker].alive` | Chuyển `true → false` bằng domain operation tương đương `killPlayer`, với cause `SPOKEN_WHILE_SILENCED` và current round. Không được set raw boolean nếu domain helper có invariant. |
| `players[speaker].deathCause`/death metadata | Ghi cause và round theo schema PlayerState hiện hành. |
| `activeSilencedIds` hoặc field tương đương | Xóa speaker khỏi active silence set; target chết không còn là enforcement target. |
| `gameState` | `DISCUSSION → CHECK_WIN`, sau đó trong cùng logical operation `CHECK_WIN → GAME_OVER`, `DISCUSSION` hoặc `VOTING`. |
| `currentRound` | Không tăng khi chỉ xử lý death trong cùng ngày. Chỉ tăng tại boundary đã được engine quy định cho next night. |
| `updatedAt` | Gán cùng logical `now` của operation. |
| `version` | Tăng thông qua `storage.saveRoom(updated, originalVersion)`; không tự ý cộng version nếu storage đã quản lý. |
| Timer metadata | Discussion timer phải được cancel/invalidated trước khi chuyển sang terminal hoặc voting. |

Event ordering phải ổn định và giống template `finalizeExecutionResolution`:

1. `PLAYER_DIED` với `cause = SPOKEN_WHILE_SILENCED`.
2. `PHASE_CHANGED` từ `DISCUSSION` sang `CHECK_WIN`.
3. `WIN_CONDITION_MET` nếu `winner !== NONE`.
4. `PHASE_CHANGED` từ `CHECK_WIN` sang `GAME_OVER`, `DISCUSSION` hoặc `VOTING`.
5. `GAME_ENDED` nếu terminal.
6. Event domain riêng cho silence violation, ví dụ `SPEECH_VIOLATION`, nếu event schema được mở rộng; event này nên chứa `speechEventId`, speaker, discussion cycle và message kind để audit, nhưng không được thay thế `PLAYER_DIED`.

Event append vào match log phải xảy ra sau khi room snapshot đã save thành công và trước hoặc cùng application boundary với `eventBus.publishAll`, theo convention hiện tại. Nếu append/publish lỗi, cần retry và cảnh báo vận hành; không được chạy lại death mutation mù quáng.

### 4.6. Thuật toán logic bắt buộc

#### Bước 0 — Acquire và validate

Đọc room mới nhất. Từ chối nếu room không ở `DISCUSSION`, enforcement chưa ready, speaker không tồn tại, speaker đã chết, event duplicate hoặc message kind không phải speech. Đây là re-check bắt buộc vì Telegram middleware và timer đều có thể chạy đồng thời.

#### Bước 1 — Idempotency gate

Ghi nhận `speechEventId` theo room/match/cycle bằng cơ chế idempotency hiện có hoặc một record tương đương. Idempotency record chỉ có hiệu lực khi operation commit; nếu implementation ghi trước room save, cần cơ chế rollback/TTL để tránh làm mất event khi CAS thất bại.

#### Bước 2 — Resolve death chain

Tạo depth-0 death:

```text
{ telegramId: speakerTelegramId, cause: SPOKEN_WHILE_SILENCED }
```

Chạy `DeathQueue.resolveOriginalDeaths` với `room.settings.hunterTriggerCauses`. Nếu cause được cấu hình trigger Hunter, tạo pending Hunter action theo cùng quy tắc chain depth đang dùng cho execution/night. Không cho phép Hunter chain vô hạn; giữ depth limit hiện tại của `DeathQueue` và không thêm recursive prompt ngoài contract.

Nếu Hunter prompt là asynchronous, tách operation thành prepare/finalize giống `prepareExecutionResolution` và `finalizeExecutionResolution`. Trong thời gian chờ prompt, room không được để ở một state mà discussion timer có thể tự chuyển sang voting. Cần persist resolution marker, ví dụ `pendingResolution = DISCUSSION_DEATH`, hoặc dùng một lock/operation record có TTL. Nếu engine chưa có marker này, phải bổ sung trước khi bật Hunter trigger trong discussion.

#### Bước 3 — Apply death atomically

Trên snapshot room đang có version hiện tại, áp dụng toàn bộ death được resolve vào `updatedPlayers`. Player đã chết trong snapshot không bị kill lần hai. Reset vote state chỉ khi contract hiện tại yêu cầu reset; không xóa ballot hợp lệ của ngày nếu discussion death chỉ tiếp tục sang voting mà không bắt đầu round mới. Việc reset phải được chốt rõ trong implementation design, vì vote hiện tại được lưu trong PlayerState và engine hiện khóa mỗi player một vote trong VOTING. [2]

#### Bước 4 — Chuyển `DISCUSSION → CHECK_WIN`

Gọi `stateMachine.assertTransition(room.gameState, GameState.CHECK_WIN)`. Không set trực tiếp enum. Tạo `PHASE_CHANGED` event trong cùng operation. Transition này là phase boundary logic dù toàn bộ operation được persist trong một lần save để tránh các snapshot trung gian không hợp lệ.

#### Bước 5 — Check win trên post-death snapshot

Tạo `roomAfterDeaths` với `updatedPlayers` và các field state đã cập nhật. Gọi `WinConditionChecker.check(roomAfterDeaths)`. Checker hiện là pure function: village thắng khi không còn werewolf sống; werewolf thắng khi số werewolf sống lớn hơn hoặc bằng số village sống. [7]

#### Bước 6 — Chọn nhánh terminal/non-terminal

| Kết quả | Transition | Event | Timer |
| --- | --- | --- | --- |
| `winner !== NONE` | `CHECK_WIN → GAME_OVER` | `WIN_CONDITION_MET`, `PHASE_CHANGED`, `GAME_ENDED` | Cancel discussion timer; không schedule phase mới. |
| `winner === NONE`, policy continue | `CHECK_WIN → DISCUSSION` | `PHASE_CHANGED`; có thể thêm `DISCUSSION_DEATH_RESOLVED` | Giữ hoặc dựng lại deadline discussion theo policy, nhưng không tạo opening announcement mới. |
| `winner === NONE`, policy vote | `CHECK_WIN → VOTING` | `PHASE_CHANGED`; có thể thêm `DISCUSSION_DEATH_RESOLVED` | Cancel discussion timer; gửi death notice/keyboard; schedule voting timer theo room snapshot mới. |

Không tăng `currentRound` ở bước này. Không chuyển `CHECK_WIN → NIGHT` khi chưa thắng, vì như vậy sẽ bỏ qua voting của ngày hiện tại.

#### Bước 7 — CAS persist và publish

Gọi storage save với original `room.version`. Nếu `ConcurrentModificationError`, bỏ toàn bộ local result, đọc room mới và retry từ Bước 0 với cùng `speechEventId`. Nếu retry thấy speaker đã chết hoặc room đã chuyển phase, trả idempotent/stale result; không kill lại.

Sau khi save thành công, append event log và publish domain events. Application layer sau đó thực hiện side effect Telegram/timer dựa trên `nextState`; không gửi message trước khi domain commit.

#### Bước 8 — Post-commit orchestration

Nếu terminal, `GameFlowController` cancel timer, gửi death announcement và game-over announcement, hiển thị role summary nếu contract hiện hành yêu cầu, unmute theo cleanup policy và clear bot policy state. Nếu non-terminal, chỉ gọi flow của phase đã chọn sau khi re-read room để tránh dùng snapshot stale.

### 4.7. Concurrency và optimistic locking

Có ít nhất bốn actor có thể chạm cùng room: speech handler, discussion timeout, vote command, callback vote hoặc startup resume. Do đó, transition phải được bảo vệ bằng cả **phase check** và **version CAS**.

| Race | Kết quả bắt buộc |
| --- | --- |
| Speech death vs discussion timeout | Chỉ một operation commit trước. Operation còn lại re-read state; nếu room đã `VOTING`/`GAME_OVER`, không làm side effect death/phase lần hai. |
| Hai speech violation gần như đồng thời | Cả hai có thể là speech hợp lệ về mặt Telegram, nhưng mỗi operation phải CAS riêng. Nếu game kết thúc bởi death thứ nhất, operation thứ hai trở thành stale và không được kill thêm. Nếu game chưa kết thúc, retry có thể xử lý speaker thứ hai trong state mới. |
| Speech death vs `/vote` | `/vote` chỉ thành công nếu discussion vẫn hợp lệ và transition hợp lệ; nếu room đang `CHECK_WIN`/resolving, trả lỗi phase hoặc chờ operation hoàn tất. |
| Speech death vs callback vote | Callback vote chỉ hợp lệ ở `VOTING`, không bị chặn bởi silence. Nếu death operation chuyển sang `VOTING`, callback chỉ dùng room state sau commit. |
| Timer stale vs terminal transition | Timer callback re-read state; nếu không còn đúng `DISCUSSION` hoặc readiness/cycle không khớp, return no-op. |

Không dùng một in-memory mutex làm cơ chế duy nhất vì process có thể restart hoặc có nhiều worker. In-memory mutex chỉ được dùng như tối ưu local; correctness phải đến từ persisted version/CAS và idempotency.

### 4.8. Timer và cleanup contract

Trước khi commit transition rời `DISCUSSION`, phải invalidate/cancel discussion timer. Do timer id có thể chỉ nằm trong memory của `GameFlowController`, cancellation cần kết hợp:

1. Hủy BullMQ job và deadline persisted nếu có.
2. Ghi `discussionCycleId`/phase marker mới hoặc xóa active deadline để job cũ tự bị từ chối.
3. Trong timer handler, re-read room và kiểm tra `gameState`, `currentRound`, `discussionCycleId` và readiness.
4. Sau khi `CHECK_WIN → VOTING`, schedule voting timer bằng room snapshot sau commit; không dùng snapshot trước death.

Nếu cancel timer thất bại do scheduler lỗi, room state vẫn phải là nguồn sự thật; stale job khi chạy phải no-op. Cần metric `stale_timer_ignored_total` để phát hiện scheduler bất ổn.

### 4.9. Ngoại lệ và error mapping

| Ngoại lệ | Phản ứng domain | Phản ứng Telegram/operational |
| --- | --- | --- |
| Room không tồn tại | `RoomNotFoundError` | Log warning; update bị bỏ qua. |
| Sai phase | `InvalidPhaseActionError` | Không xóa message nếu chưa có policy; không tạo death. |
| Speaker đã chết | `DeadPlayerActionError` hoặc no-op theo message middleware contract | Mute/delete theo policy; không Hunter trigger. |
| Target silence hết hạn | `NOT_SILENCED` | Không thông báo death. |
| Duplicate `speechEventId` | Idempotent result/no-op | Không gửi duplicate notice. |
| CAS conflict | Retry tối đa theo policy hiện tại | Nếu hết retry, log structured error và đưa vào retry queue/alert; không phát nửa event. |
| Hunter prompt timeout | Áp `defaultTimeoutBehavior`/Hunter-specific policy đã chốt | Persist decision as skip/null; tiếp tục finalize một lần. |
| Telegram send failure | Domain state không rollback | Retry announcement; enforcement không bật nếu là opening announcement. Với death announcement sau commit, retry outbox/notification là bắt buộc. |
| Redis unavailable | Không được tự động coi player là không silenced nếu điều đó tạo bypass không kiểm soát | Fail closed cho enforcement decision hoặc đưa update vào retry policy đã chốt; phát alert. |
| Event append/publish failure | Không rerun mutation mù quáng | Retry append/publish theo event identity; audit log phải truy vết được. |

## 5. Night action interaction

Silent Mage action phải tuân theo tính final của night submission hiện tại:

1. Khi submit, caster phải còn sống, đúng phase, đúng role/action, target hợp lệ và chưa vi phạm self-target/repeat-target policy.
2. Sau khi submit hợp lệ, action được lưu trong `pendingNightActions`.
3. Khi resolver chạy, không hủy action chỉ vì caster bị giết trong cùng night; điều này nhất quán với Seer/Witch hiện tại. [5]
4. Sau death finalization, target đã chết không được nằm trong `activeSilencedIds` và không được nhận public silence announcement.
5. Nếu caster chết trước lúc submit, action bị từ chối như mọi dead-player action khác.

Night action order mặc định hiện kết thúc ở `WITCH_POISON`; Silent Mage action nếu được bật phải có thứ tự cấu hình rõ ràng, mặc định sau Witch poison theo thiết kế đã audit. [6] Tuy nhiên, việc đặt action ở cuối không được hiểu là silence có thể hồi sinh hoặc áp lên target đã chết; target filtering vẫn chạy trên finalized alive state.

---

# Phần II — Giải pháp race condition của announcement đầu ngày

## 6. Nguyên nhân chính xác

Race condition phát sinh do hai hệ thống có boundary khác nhau:

1. `DayService::startDiscussion` persist `gameState = DISCUSSION` và phát `PHASE_CHANGED`.
2. `GameFlowController::startDiscussion` mới gọi `await bot.telegram.sendMessage(...)` để gửi public announcement.
3. Speech middleware xử lý Telegram update độc lập với coroutine đang chờ Telegram API.
4. Trong khoảng giữa bước 1 và bước 2 hoàn tất, một speech message có thể đến và bị đánh giá như message trong discussion.

`await` chỉ bảo đảm thứ tự trong chính coroutine `startDiscussion`; nó không khóa các Telegram update khác và không tạo transaction xuyên qua Redis/storage và Telegram API. [3] Vì Telegram không cung cấp read receipt cho group announcement, “announcement hoàn tất” trong đặc tả được định nghĩa là Telegram API trả về thành công/accepted, không phải mọi thành viên đã đọc message.

## 7. Giải pháp được chọn: persisted readiness gate + CAS + idempotent recovery

### 7.1. Lý do chọn

Giải pháp phù hợp nhất với hệ thống hiện tại là giữ `GameState.DISCUSSION` nhưng bổ sung một **discussion opening lifecycle** persisted, thay vì thêm `DISCUSSION_OPENING` vào enum ngay trong giai đoạn đầu. Cách này có diff domain nhỏ hơn micro-state, vẫn restart-safe nếu field được persist, và tránh việc speech handler phải hiểu thêm một GameState mới.

Đề xuất schema logic:

```text
DiscussionLifecycle = OPENING | ACTIVE | RESOLVING | CLOSED

RoomState discussion fields:
  discussionCycleId: string | null
  discussionLifecycle: DiscussionLifecycle
  discussionEnforcementReady: boolean
  discussionAnnouncementAttemptId: string | null
  discussionAnnouncementSentAt: number | null
  discussionDeadlineAt: number | null
  discussionResolutionId: string | null
```

Đây là contract thiết kế; tên field có thể thay đổi khi code review. Các field phải được versioned cùng `RoomState`, có default an toàn cho room cũ: nếu room ở `DISCUSSION` nhưng thiếu metadata, coi là `OPENING/ready=false` và chạy recovery, không bật enforcement ngay.

### 7.2. Hai-phase opening protocol

#### Phase A — Open discussion, enforcement chưa sẵn sàng

Trong một optimistic transaction:

1. Re-read room và yêu cầu `gameState === DAY`.
2. Assert `DAY → DISCUSSION`.
3. Sinh `discussionCycleId`/`announcementAttemptId` duy nhất.
4. Set `discussionLifecycle = OPENING`, `discussionEnforcementReady = false`.
5. Xóa deadline cũ và chưa schedule discussion timeout.
6. Persist room và `PHASE_CHANGED(DAY, DISCUSSION)` cùng opening metadata.

Sau commit, room đã ở `DISCUSSION` để domain biết phase mới, nhưng speech gate vẫn đóng. Speech handler khi đọc room `OPENING` phải pass-through theo policy, không tạo violation.

#### Phase B — Send announcement ngoài transaction

Gửi `Messages.discussionStarted(seconds)` bằng `announcementAttemptId` làm correlation/idempotency key. Không giữ distributed lock trong lúc chờ Telegram API; lock dài theo network call dễ hết hạn và gây deadlock/throughput thấp.

Nếu Telegram trả thành công, tiếp tục Phase C. Nếu trả lỗi, giữ room ở `OPENING`, `ready=false`; không schedule enforcement timer. Retry worker hoặc startup recovery sẽ gửi lại cùng logical announcement attempt.

#### Phase C — Activate bằng CAS

Trong transaction thứ hai:

1. Re-read room.
2. Yêu cầu `gameState === DISCUSSION`.
3. Yêu cầu `discussionCycleId` và `announcementAttemptId` khớp.
4. Yêu cầu lifecycle vẫn là `OPENING`.
5. Set `discussionLifecycle = ACTIVE`, `discussionEnforcementReady = true`, `discussionAnnouncementSentAt = now`.
6. Set `discussionDeadlineAt = now + discussionSeconds`.
7. Persist bằng expected version.

Nếu CAS thất bại vì room đã chuyển phase hoặc terminal, không bật gate. Announcement có thể đã được gửi nhưng được coi là stale; không tạo enforcement cho cycle cũ.

#### Phase D — Schedule timer sau activation

Sau khi Phase C commit thành công, schedule discussion timer với job id deterministic, ví dụ theo room/cycle/phase. Deadline nên được persist trước hoặc trong scheduling wrapper theo convention `RoomTimerService`; timer handler vẫn phải re-read room.

Nếu schedule thất bại, room vẫn `ACTIVE` nhưng có deadline persisted; recovery sẽ schedule lại. Không reset `ready=false` chỉ vì BullMQ tạm lỗi, vì announcement đã thành công và enforcement semantics đã active.

### 7.3. Message handling contract

Speech middleware phải phân biệt rõ:

| Update | `OPENING`, `ready=false` | `ACTIVE`, `ready=true` | Ngoài `DISCUSSION` |
| --- | --- | --- | --- |
| Text/voice/sticker/GIF trong group | Không tính violation; xử lý theo policy message bình thường | Đánh giá silence và có thể gọi `resolveDiscussionDeath` | Không đánh giá Silent Mage speech violation. |
| Callback query vote | Không bị silence gate | Không bị silence gate | Được callback handler kiểm tra phase riêng. |
| `/vote` command | Command handler/phase validation riêng; không coi là speech violation | Không coi là speech violation; command có thể chuyển phase theo contract | Xử lý theo command validation. |
| Private action callback | Handler riêng | Handler riêng | Handler riêng. |

`src/index.ts` hiện chỉ gate `ctx.message` trong group/supergroup; `actionCallbackHandler.ts` đăng ký `callback_query` riêng. Ranh giới này phải được bảo toàn. [4] [8]

### 7.4. Lock, queue, transaction: đánh giá

| Cơ chế | Vai trò đề xuất | Ưu điểm | Nhược điểm |
| --- | --- | --- | --- |
| Optimistic CAS/version | Cơ chế correctness chính cho opening activation và discussion death | Đã có sẵn trong `DayService`; phù hợp Redis storage và multi-worker; tránh lock dài | Có thể retry nhiều lần dưới contention; cần idempotency để không duplicate side effect. |
| In-memory mutex | Chỉ là tối ưu local cho cùng process | Giảm duplicate local calls | Không an toàn khi restart/multi-instance; không được dùng làm invariant chính. |
| Redis distributed lock | Chỉ dùng ngắn quanh orchestration/finalize nếu cần | Có thể giảm thundering herd | TTL/network failure phức tạp; không giữ lock khi gọi Telegram; lock không thay CAS. |
| Queue/outbox | Retry announcement, event publish và notification sau commit | Không mất side effect khi Telegram/BullMQ lỗi; dễ quan sát | Cần schema/job idempotency và worker recovery; không thay thế domain transaction. |
| Atomic storage transaction | Commit room metadata + event/idempotency nếu storage hỗ trợ | Rõ ràng nhất cho domain mutation | Phụ thuộc capability storage; hiện pattern chính là optimistic `saveRoom(expectedVersion)` và append event sau save. |

**Kết luận:** Không chọn “lock trong suốt quá trình gửi Telegram”. Chọn **CAS cho domain state**, **idempotency key cho announcement/event**, và **queue/retry/outbox cho external side effects**. Nếu storage chưa có multi-key transaction, tối thiểu phải lưu opening metadata và sử dụng version CAS; không bật readiness trước khi Telegram success.

### 7.5. Recovery và crash matrix

| Crash/failure point | State sau failure | Recovery bắt buộc |
| --- | --- | --- |
| Trước Phase A commit | `DAY` | Gọi start discussion lại bình thường. |
| Sau Phase A, trước Telegram send | `DISCUSSION`, `OPENING`, `ready=false` | Resend announcement bằng cùng attempt id; không enforce; không start voting. |
| Sau Telegram success, trước Phase C | `OPENING`, `ready=false` | Có thể resend hoặc xác nhận send log rồi CAS activate; không enforce trước CAS. |
| Sau Phase C, trước schedule timer | `ACTIVE`, `ready=true`, deadline persisted | Schedule job lại theo deterministic id; speech enforcement được phép. |
| Timer job chạy sau terminal transition | `GAME_OVER` hoặc phase khác | Handler no-op sau re-read. |
| Announcement sent twice do retry | Có thể có duplicate Telegram messages | Dùng attempt id/log/outbox để suppress khi có thể; nếu Telegram API không hỗ trợ idempotency end-to-end, duplicate notification là limitation cần metric/alert, nhưng readiness không được bật sớm. |

### 7.6. Ưu và nhược điểm của giải pháp đã chọn

**Ưu điểm** là không làm phình `GameState` ngay, tương thích với optimistic locking hiện tại, xử lý restart an toàn hơn boolean in-memory, và thể hiện chính xác boundary giữa domain transition và external Telegram delivery. Nó cũng cho phép speech handler tự quyết định dựa trên persisted state thay vì phụ thuộc vào thứ tự gọi trong `GameFlowController`.

**Nhược điểm** là schema `RoomState` phải mở rộng, room cũ cần default/migration, opening recovery phải được viết và kiểm thử, và có khả năng Telegram announcement bị duplicate khi retry. Ngoài ra, “API accepted” không đồng nghĩa người chơi đã đọc; đây là giới hạn khách quan của Telegram group messaging.

### 7.7. Alternative: transient `DISCUSSION_OPENING` GameState

Thêm enum state riêng là phương án có semantic clarity cao hơn: `DAY → DISCUSSION_OPENING → DISCUSSION`. Tuy nhiên, nó kéo theo cập nhật transition table, timer mapping, overdue resume, `/status`, command guards, bot scheduling, telemetry và mọi test kiểm tra state. Nếu sau này hệ thống cần nhiều phase-opening gates, đây có thể là hướng tốt; cho Silent Mage hiện tại, persisted lifecycle field là lựa chọn ít rủi ro migration hơn.

---

# Phần III — Readiness assessment, kiểm thử và rollout

## 8. Đánh giá mức độ sẵn sàng hiện tại

**Trạng thái hiện tại: Not production-ready / implementation blocked.** Audit đã xác định đúng hướng kiến trúc nhưng chưa có implementation contract cho năm blocker: speech readiness gate, discussion-death transition, silence persistence, BotPolicy simulation và Hunter trigger policy. [6]

| Hạng mục | Trạng thái | Mức độ |
| --- | --- | --- |
| State machine transition | Chưa có `DISCUSSION → CHECK_WIN` | P0 blocker |
| Atomic death flow | Chưa có service/resolution contract | P0 blocker |
| Win check sau discussion death | Chưa có integration | P0 blocker |
| Announcement readiness | Chưa có persisted gate | P0 blocker |
| Timer cancel/recovery | Có pattern nhưng chưa tích hợp discussion death/opening | P0 blocker |
| Silence target persistence/expiry | Chưa có field contract trong RoomState/PlayerState | P0 blocker |
| Speech normalization | Chưa có contract đầy đủ cho text/voice/sticker/GIF | P0 blocker |
| Callback vote isolation | Có separation hiện tại | Pass baseline; cần regression test |
| Night action finality | Pattern hiện tại đủ làm baseline | Pass design; cần test role-specific |
| BotPolicy silence model | Chưa có | P1 blocker cho test confidence |
| Hunter discussion trigger | Chưa có policy đầy đủ | P0/P1 tùy bật default |
| Observability/idempotency | Có event/version patterns nhưng chưa có speech event schema | P1 |

## 9. Acceptance criteria bắt buộc

### 9.1. Domain/state acceptance

| ID | Tiêu chí pass |
| --- | --- |
| TS-DOM-01 | `DISCUSSION → CHECK_WIN` chỉ xảy ra khi room đang `DISCUSSION`, enforcement active và speech event hợp lệ. |
| TS-DOM-02 | Mọi transition được kiểm tra bằng `GameStateMachine.assertTransition`; không có direct mutation bypass. |
| TS-DOM-03 | Speaker bị kill tối đa một lần dù cùng `speechEventId` retry hoặc hai worker xử lý đồng thời. |
| TS-DOM-04 | `PLAYER_DIED` được emit trước terminal events; winner được tính trên room sau death. |
| TS-DOM-05 | Nếu winner đạt điều kiện, state cuối là `GAME_OVER`, có `WIN_CONDITION_MET` và `GAME_ENDED`, không còn deadline/timer active cho discussion. |
| TS-DOM-06 | Nếu chưa thắng, state cuối là `DISCUSSION` hoặc `VOTING` theo product policy đã chọn; không được rơi vào `NIGHT` nếu chưa qua ballot. |
| TS-DOM-07 | `currentRound` không tăng khi xử lý discussion death cùng ngày. |
| TS-DOM-08 | `activeSilencedIds` không chứa player đã chết. |
| TS-DOM-09 | Hunter trigger được áp đúng theo `hunterTriggerCauses`, giới hạn chain depth và timeout policy. |

### 9.2. Announcement/enforcement acceptance

| ID | Tiêu chí pass |
| --- | --- |
| TS-RACE-01 | Trong `OPENING`, mọi speech update đều không tạo violation/death. |
| TS-RACE-02 | `discussionEnforcementReady` chỉ được bật sau khi announcement send trả success. |
| TS-RACE-03 | Activation dùng CAS với cycle/attempt identity; stale activation không thể bật gate cho room đã đổi phase. |
| TS-RACE-04 | Crash giữa send và activation phục hồi bằng retry mà không enforce sớm. |
| TS-RACE-05 | Timer chỉ được schedule sau activation; stale timer không chuyển room đã terminal sang voting. |
| TS-RACE-06 | Callback query vote của player sống nhưng silenced vẫn cast được ở `VOTING`. |
| TS-RACE-07 | Text, voice, sticker và GIF được phân loại theo cùng speech contract; command/callback không bị coi là speech. |

### 9.3. Restart and observability acceptance

| ID | Tiêu chí pass |
| --- | --- |
| TS-OPS-01 | Restart sau mỗi checkpoint trong opening protocol không làm mất room hoặc bật enforcement sai thời điểm. |
| TS-OPS-02 | Event log có đủ correlation: `roomId`, `matchId`, `round`, `discussionCycleId`, `speechEventId`, actor và cause. |
| TS-OPS-03 | Duplicate handler execution không tạo duplicate death/game-over side effect. |
| TS-OPS-04 | Có metric/log cho CAS retry, stale timer, opening recovery, duplicate speech event, Telegram announcement failure và Hunter timeout. |
| TS-OPS-05 | Không có unhandled rejection từ timer, bot chat hoặc Telegram notification làm process crash. |

## 10. Kế hoạch kiểm thử

### 10.1. Unit tests — pure domain và state machine

Unit suite phải kiểm tra transition table mới, `canTransition`, `assertTransition`, `possibleNextStates` và terminal semantics. Các case tối thiểu gồm:

| Nhóm | Case |
| --- | --- |
| Transition | `DISCUSSION → CHECK_WIN` pass; transition từ `DAY/VOTING/GAME_OVER` vào `CHECK_WIN` chỉ pass khi được contract cho phép; `CHECK_WIN → GAME_OVER` pass; non-terminal return path pass. |
| Win | Speaker death làm Sói đạt parity; speaker death làm hết Sói; speaker death chưa kết thúc game. |
| Idempotency | Cùng `speechEventId` hai lần; cùng speaker hai worker; retry sau CAS conflict. |
| Validation | Chưa ready, ngoài discussion, speaker dead, không silenced, message kind không hợp lệ, player ngoài room. |
| DeathQueue | Hunter trigger bật/tắt; chain depth; Hunter target invalid/dead; timeout skip. |
| Target filtering | Silent target chết trong night bị loại; target sống nhận effect; caster chết sau submit vẫn action final. |
| Vote isolation | Silenced alive player vote callback được; speech handler không gọi submitVote. |

### 10.2. Service/integration tests — storage, event log, timers

Test với storage thật hoặc test double có optimistic version phải chứng minh room save và event ordering. Cần mô phỏng `ConcurrentModificationError` có chủ ý, event append failure, event publish failure, scheduler failure và Redis timeout.

Một test integration quan trọng phải kiểm tra operation chỉ save một final snapshot hợp lệ, không để storage quan sát trạng thái trung gian `CHECK_WIN` nếu transaction contract yêu cầu atomic finalization. Event log vẫn phải chứa phase events theo thứ tự logic.

Timer integration phải tạo deadline persisted, cancel job, chạy stale job sau transition và xác minh callback no-op. Startup resume phải test ba room: `OPENING/ready=false`, `ACTIVE/ready=true`, `GAME_OVER` không còn deadline.

### 10.3. Telegram/E2E tests

E2E cần dùng update fixtures cho tất cả message type và callback. Không chỉ kiểm tra message text; phải assert room state, player alive, death cause, event log, timer state và số lần notification.

| Scenario | Kỳ vọng |
| --- | --- |
| Speech trong opening trước announcement success | Không death, không Hunter trigger. |
| Speech ngay sau activation | Vi phạm được xử lý đúng một lần. |
| Announcement API fail rồi retry | Gate vẫn false cho đến success; retry recovery hoàn tất. |
| Silent player gửi text | Death `SPOKEN_WHILE_SILENCED`. |
| Silent player gửi voice/sticker/GIF | Kết quả theo cùng speech contract. |
| Silent player callback vote | Vote thành công nếu còn sống và phase `VOTING`. |
| Dead player gửi message | Không tạo death thứ hai; xử lý mute/delete theo policy. |
| Mage chết sau submit | Target effect vẫn resolve nếu target còn sống ở finalized snapshot. |
| Target chết trong night | Không public silence/không active enforcement cho target đó. |
| Hunter trigger trong discussion | Prompt/timeout/chain deterministic, không duplicate resolution. |
| Discussion death thắng ngay | `GAME_OVER`, game-over announcement một lần, cleanup hoàn tất. |
| Discussion death chưa thắng | Đúng return path `DISCUSSION` hoặc `VOTING`; không tự nhảy `NIGHT`. |

### 10.4. Concurrency and stress tests

Chạy deterministic concurrency tests với barrier để phát đồng thời:

1. Một speech event và discussion timeout.
2. Hai speech events từ hai player silenced.
3. Speech event và `/vote`.
4. Speech event và callback vote.
5. Timer callback và startup resume.
6. Telegram send success nhưng activation request retry nhiều lần.

Sau đó chạy tối thiểu **100 round regression** theo baseline bottest hiện có, bao gồm role configurations không có Silent Mage và có Silent Mage. So sánh:

| Metric | Yêu cầu |
| --- | --- |
| Unhandled exception | 0 |
| Invalid state transition ngoài expected stale/no-op | 0 |
| Duplicate death per event | 0 |
| Duplicate game-over event | 0 |
| Speech violation trước readiness | 0 |
| Callback vote bị chặn do silence | 0 |
| Orphan silenced dead player | 0 |
| Stale timer chuyển sai phase | 0 |
| CAS retry exhaustion | 0 trong test bình thường; các test fault injection phải được alert đúng. |
| Memory/CPU/latency | Không tăng bất thường so với baseline không có role. |

BotPolicy phải được mở rộng trước khi dùng bottest làm bằng chứng behavior. Bot cần có `canSpeak`, silence expiry, deliberate violation mode và observation `SPEECH_ATTEMPT`; nếu không, E2E chỉ chứng minh engine với người dùng giả lập chứ không chứng minh behavior simulation. [6]

### 10.5. Restart/resume tests

Restart test phải dừng process tại từng checkpoint của opening protocol và resolution:

| Checkpoint | Điều cần xác minh |
| --- | --- |
| Sau `DAY → DISCUSSION`, trước send | Room opening, gate false, recovery gửi lại announcement. |
| Sau send success, trước activate CAS | Gate vẫn false; retry activate được; không có speech death. |
| Sau activate, trước schedule timer | Gate true; deadline persisted; job được schedule lại. |
| Sau death save, trước event publish | Room final không bị kill lại khi worker restart; events retry theo identity. |
| Sau `CHECK_WIN → GAME_OVER` | Không resume discussion/voting; announcement game over idempotent. |
| Trong Hunter prompt | Pending resolution tồn tại; timeout/resume không chạy resolution hai lần. |

## 11. Kế hoạch giảm thiểu rủi ro

### 11.1. Risk register

| Risk | Probability | Impact | Mitigation | Go/no-go |
| --- | --- | --- | --- | --- |
| Direct state bypass | Trung bình | Rất cao | Centralize transition, unit test `assertTransition`, review cấm raw assignment | No-go nếu còn bypass. |
| Announcement send/activation race | Cao | Cao | Opening lifecycle, gate false default, CAS activation, recovery | No-go nếu thiếu TS-RACE-01..05. |
| Duplicate death do retry | Trung bình | Rất cao | Event/action idempotency, version CAS, deterministic operation id | No-go nếu duplicate repro được. |
| Stale discussion timer | Cao | Cao | Cancel + persisted deadline invalidation + re-read guard | No-go nếu timer đổi sai phase. |
| Silence state stale sau restart | Trung bình | Cao | Persist expiry/cycle, migration default-safe, restart tests | No-go nếu dead target còn active. |
| Hunter prompt treo | Trung bình | Cao | Tách prepare/finalize, timeout, operation marker, chain depth | No-go nếu có double finalize. |
| Bot simulation không phản ánh silence | Cao | Trung bình | BotPolicy contract và dedicated E2E | Có thể rollout domain sau khi engine pass, nhưng không gọi readiness full. |
| Telegram duplicate notification | Trung bình | Trung bình | Outbox/attempt identity, retry policy, metric | Chấp nhận có kiểm soát nếu domain không duplicate; phải có alert. |
| Redis/storage outage | Thấp–trung bình | Rất cao | Fail-safe policy, retry, health metric, không suy diễn silence state | No-go nếu outage gây bypass im lặng không audit được. |
| Compatibility room cũ | Trung bình | Cao | Default `OPENING/ready=false`, migration/read-repair, fixture tests | No-go nếu room cũ bị enforce sai. |

### 11.2. Thứ tự triển khai khuyến nghị

1. Chốt product contract: non-terminal return path, silence lifetime, target-dead rule, speech types và Hunter prompt policy.
2. Mở rộng domain schema và migration với default an toàn; chưa bật role.
3. Mở rộng state machine và atomic discussion-death service theo template DayService.
4. Tích hợp `WinConditionChecker`, DeathQueue và timer invalidation.
5. Tích hợp opening lifecycle/readiness gate và recovery.
6. Tích hợp Telegram speech classifier; giữ callback vote độc lập.
7. Mở rộng BotPolicy/bottest và telemetry.
8. Chạy unit/integration/E2E/concurrency/restart suite.
9. Canary trong môi trường test hoặc room nội bộ; theo dõi metric.
10. Chỉ bật production sau sign-off toàn bộ P0 acceptance criteria.

### 11.3. Rollback strategy

Role flag phải có khả năng tắt trước khi tạo match mới. Không tắt giữa match nếu việc đó làm mất schema semantics; thay vào đó, match đã bật role phải chạy đến terminal hoặc được migrate theo một procedure riêng.

Nếu phát hiện lỗi sau canary, dừng tạo match mới có Silent Mage, giữ engine đọc được state đã persist, tắt speech enforcement mới cho room chưa active và dùng recovery procedure cho room đang `OPENING`. Không xóa `activeSilencedIds` bằng migration nóng nếu chưa xác minh event log, vì có thể làm mất bằng chứng và tạo inconsistency với role state.

## 12. Phạm vi triển khai và giới hạn

### 12.1. Trong phạm vi

Đặc tả bao phủ state transition, atomic death logic, win check, event ordering, optimistic locking, idempotency, timer cancellation, opening readiness gate, Telegram/message-vs-callback boundary, NightResolver finality assumption, Hunter interaction contract, BotPolicy requirements, test plan, restart/resume behavior và rollout gate.

### 12.2. Ngoài phạm vi

Tài liệu không triển khai code, không thay đổi role registry, không thiết kế UI hoàn chỉnh, không quyết định lại toàn bộ luật Werewolf, không đảm bảo Telegram user đã đọc announcement, không thay thế load test hạ tầng production, và không chứng minh behavior balance/win-rate của role. Balance cần một nghiên cứu Monte Carlo riêng sau khi engine contract ổn định.

Tài liệu cũng không coi mute transport của Telegram là domain enforcement. Việc xóa message là defense-in-depth; quyết định death phải dựa trên domain state và event processing. Nếu Telegram không cho bot xóa một loại message, domain vẫn phải có kết quả nhất quán theo policy đã chốt.

## 13. Definition of Ready và Definition of Done

### Definition of Ready — trước khi bắt đầu code

Feature chỉ đạt Ready khi product owner đã ký quyết định về `CHECK_WIN → DISCUSSION` hay `CHECK_WIN → VOTING`, silence duration/expiry, target chết trong night, speech message taxonomy, Hunter trigger default, timeout behavior và compatibility policy cho room cũ.

Tech lead phải phê duyệt schema lifecycle, event names/payloads, idempotency key, storage CAS boundary, recovery state machine và timer job identity. QA phải có test matrix tương ứng với acceptance criteria trong mục 9.

### Definition of Done — trước khi bật production

Feature chỉ đạt Done khi tất cả P0 acceptance criteria pass, unit/integration/E2E/concurrency/restart tests pass, stress 100 round không có regression, event log và metrics đã được kiểm tra, canary không có duplicate death/stale timer, rollback đã diễn tập và source review xác nhận không có direct state bypass.

## 14. Kết luận triển khai

Phương án A là lựa chọn an toàn hơn phương án B vì bảo toàn `GameStateMachine` là nguồn sự thật và ngăn room terminal bị lưu nhầm dưới `DISCUSSION`. Tuy nhiên, A chỉ đáng tin cậy nếu được triển khai như một transaction-level resolution với đầy đủ `CHECK_WIN` return path, post-death win check, CAS, idempotency và timer invalidation.

Race condition announcement không nên giải quyết bằng cách giữ một lock trong suốt cuộc gọi Telegram. Giải pháp thực tế phù hợp hệ thống hiện tại là **persisted opening lifecycle + `discussionEnforcementReady=false` mặc định + Telegram send ngoài transaction + CAS activation + idempotent retry/recovery**. Cách này giảm race window, restart-safe và không làm callback vote phụ thuộc vào speech enforcement.

**Đánh giá cuối:** Có thể chuyển sang implementation planning sau khi chốt các product contract còn thiếu. Chưa thể tuyên bố sẵn sàng triển khai production trước khi toàn bộ P0 acceptance criteria, concurrency tests và restart/resume tests pass.

## References

[1]: src/engine/state-machine/GameStateMachine.ts "Transition table và assertTransition"
[2]: src/engine/DayService.ts "Day lifecycle, optimistic retry, execution finalization và event ordering"
[3]: src/telegram/GameFlowController.ts "startDiscussion, announcement, timers và post-resolution orchestration"
[4]: src/index.ts "Message middleware, callback registration và overdue room resume"
[5]: src/engine/night/NightResolver.ts "Night action resolution, caster death finality và death finalization"
[6]: silent-mage-design-audit-v2.md "Audit vòng 2: race condition, target-dead filtering, BotPolicy và phương án A/B"
[7]: src/engine/win-condition/WinConditionChecker.ts "Pure win-condition checker"
[8]: src/telegram/handlers/actionCallbackHandler.ts "Callback query vote/night action handler"
[9]: src/engine/domain/Room.ts "RoomState, settings, version và pending night actions"
[10]: src/engine/domain/Player.ts "PlayerState, alive state và killPlayer contract"
[11]: src/engine/night/DeathQueue.ts "Hunter trigger causes và chain-depth behavior"
[12]: src/engine/RoomTimerService.ts "Persisted deadline, timer cancellation và overdue recovery"
[13]: src/telegram/BotPolicy.ts "Bot belief, observation và discussion simulation"
[14]: src/telegram/commands/bottest.ts "Bottest room/role setup và test harness"
