# Silent Mage — Design Audit

**Phạm vi:** Audit thiết kế trước khi implement role `Pháp sư câm / Silent Mage`.

**Kết luận ngắn:** Không nên giao code theo nguyên trạng cả 8 quyết định. Các quyết định **1, 3, 4, 5, 7, 8** có thể trở thành thiết kế hợp lệ sau khi bổ sung contract và orchestration; quyết định **2** đang xung đột trực tiếp với state machine hiện tại; quyết định **6** chưa có persistence/announcement contract cần thiết. Điểm rủi ro lớn nhất là **cái chết giữa DISCUSSION**: engine hiện chỉ mutate death và check win trong các pipeline night/execution, không có application service cho death tùy ý trong discussion.

> **Lưu ý về phạm vi kiểm tra:** Report này chỉ đọc source và tài liệu. Không tạo role mới, không đăng ký role vào `RoleRegistry`, không sửa bất kỳ source file nào.

## Ma trận kết luận

| # | Quyết định | Kết luận | Mức rủi ro nếu code nguyên trạng |
| --- | --- | --- | --- |
| 1 | Định nghĩa “Nói” là group message trong DISCUSSION, không tính callback hoặc `/vote` | **Không chắc chắn** | Trung bình |
| 2 | Death giữa DISCUSSION là side-effect đồng bộ, check win ngay, không thêm state transition | **Sai** | Rất cao |
| 3 | Bodyguard/Witch không chặn death này | **Đúng về semantics, chưa có implementation** | Trung bình |
| 4 | `SPOKEN_WHILE_SILENCED` là Hunter trigger, configurable | **Đúng về kiến trúc, chưa có trong default** | Cao |
| 5 | Cấm self-target, cho phép repeat-target | **Đúng nếu áp dụng riêng cho Silent Mage** | Thấp–trung bình |
| 6 | Công khai người bị câm đầu ngày | **Không chắc chắn** | Trung bình |
| 7 | Silence action chạy cuối night, sau Witch poison | **Đúng về insertion point, chưa có action/resolution** | Cao |
| 8 | `reactsToOwnDeath:false` và thêm 3 enum | **Đúng nhưng chưa đủ** | Trung bình |

## 1. “Nói” là message group trong DISCUSSION; không tính callback hoặc `/vote`

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Không chắc chắn** | `src/index.ts` middleware nhận mọi `ctx.message` trong group/supergroup và chỉ trích `text` để nhận diện `/end`; callback query được đăng ký riêng. `actionCallbackHandler.ts` tách callback `VOTE` và night action khỏi message flow. `GameFlowController.ts::scheduleBotDiscussion` chỉ phát bot chat trong `DISCUSSION`, không có event chuẩn hóa cho message người thật. [1] [2] [3] | Code hiện chưa có khái niệm domain “spoken event”. Text, voice, sticker, GIF và media đều đi qua các loại Telegram update khác nhau; nếu chỉ kiểm tra `ctx.message.text` sẽ bỏ sót voice/sticker/GIF. Ngoài ra, middleware hiện không kiểm tra `gameState === DISCUSSION`; nó chỉ kiểm tra group và mute status. | Định nghĩa một `SpeechObservation`/message-normalization contract ở Telegram layer: `chatId`, `senderId`, `messageId`, `kind`, `gameStateAtReceipt`, `isCommand`, `isCallback=false`. Chỉ coi update là “nói” khi room đang `DISCUSSION`, sender còn sống, update là group message thuộc các loại đã chốt. `/vote` phải loại qua command classification; callback query bị loại ngay từ đầu. |

Hiện tại callback và lệnh `/vote` thực sự là các kênh khác: callback `action:VOTE:<target>` gọi `DayService.submitVote`, còn `/vote` gọi transition mở voting. Vì vậy phần “không tính callback hoặc `/vote`” phù hợp với phân tách transport hiện hữu. Tuy nhiên, phần “text/voice/sticker/GIF” chưa thể khẳng định đúng với behavior domain hiện tại vì engine chưa nhận một speech event thống nhất; middleware chỉ biết `ctx.message`, delete muted message và stop propagation. [1] [2]

**Khuyến nghị:** Giữ định nghĩa nghiệp vụ này, nhưng viết rõ “nói” là **một group message hợp lệ đã được normalize**, không phải mọi `ctx.message` bất kể phase. Cần chốt thêm liệu command khác ngoài `/vote`, caption của media, forwarded message và edited message có được tính hay không.

## 2. Death giữa DISCUSSION là side-effect đồng bộ, check win ngay, không thêm state transition

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Sai** | `GameStateMachine` chỉ cho `DAY -> DISCUSSION`, `DISCUSSION -> VOTING`; không có `DISCUSSION -> CHECK_WIN` hoặc `DISCUSSION -> GAME_OVER`. `DayService::finalizeExecutionResolution` mới là nơi gọi `WinConditionChecker`, sau đó chuyển `EXECUTION -> CHECK_WIN -> GAME_OVER/NIGHT`. `NightResolver` cũng defer mutation đến `applyHunterRevengeAndFinalize`; không có service cho death giữa discussion. [4] [5] [6] | Nếu đánh dấu player chết rồi gán `GAME_OVER` trực tiếp từ `DISCUSSION`, state machine contract bị bypass. Có thể phát sinh race với discussion timer, scheduled `startVoting`, bot chat timeout và restart-resume logic. Nếu death chưa kết thúc game, “loại player khỏi vote hiện tại” không có nghĩa rõ ràng vì vote chỉ bắt đầu sau `DISCUSSION -> VOTING`; còn nếu death xảy ra sau khi voting đã mở thì đó là một flow khác. Atomicity cũng quan trọng: death, `PLAYER_DIED`, win check, mute và announcement phải không bị tách thành các snapshot mâu thuẫn. | Chọn một trong hai contract rõ ràng: **(A)** thêm transition hợp lệ `DISCUSSION -> CHECK_WIN -> GAME_OVER/NIGHT` và một service atomic cho discussion death; hoặc **(B)** giữ gameState `DISCUSSION` khi chưa kết thúc, nhưng vẫn phải có application service atomic `applyDiscussionDeath` ghi `PlayerState`, event và kết quả win, đồng thời chặn/huỷ timer và kiểm tra room version. Không nên nói “check win ngay nhưng không có transition” nếu vẫn muốn engine state machine là nguồn sự thật. |

`WinConditionChecker::check` là pure function và có thể được gọi trên bất kỳ snapshot nào: Village thắng khi `aliveWerewolves === 0`, Werewolf thắng khi `aliveWerewolves >= aliveVillagers`, nếu không thì `NONE`. Nhưng khả năng gọi pure checker không đồng nghĩa với việc `RoomState` có thể chuyển trực tiếp từ `DISCUSSION` sang terminal state. [7]

Phần “nếu chưa thắng thì chỉ loại player khỏi vote hiện tại” cũng cần sửa ngôn ngữ. Ở `DISCUSSION`, chưa có ballot hiện tại; `VoteResolver` chỉ đọc những người sống đã `hasVotedThisRound` trong `VOTING`. Nếu muốn hỗ trợ death sau khi voting bắt đầu, đó phải là một quyết định khác với contract riêng về xóa target chết, hủy ballot của voter chết và re-tally. [5] [8]

## 3. Bodyguard protect và Witch save không chặn được death này

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Đúng về semantics, chưa có implementation** | `NightResolver::resolveWithoutHunterRevenge` chỉ dùng `protectedThisNight` và `savedThisNight` để ngăn `werewolfVictimId` trở thành `DeathCause.WEREWOLF_KILL`. Witch save cũng chỉ tham gia night pipeline. `BodyguardRole` và `WitchRole` validate night action, không có hook chặn arbitrary discussion death. [5] [9] | Nếu implementation mới đưa Silent Mage death vào `werewolfVictimId`, `WITCH_POISON` hoặc một nhánh được protection/save kiểm tra, nó sẽ vô tình làm lệch luật. Nếu dùng `DeathCause.SPOKEN_WHILE_SILENCED` độc lập nhưng vẫn đi qua `DeathQueue`, Hunter có thể trigger theo cấu hình; đó là side-effect cần chủ động chấp nhận. | Giữ death cause độc lập và áp dụng sau khi kết thúc các night effects, hoặc định nghĩa rõ trong resolution order rằng silence violation death không bị protection/save. Tạo test matrix: Mage silences target → target nói → Bodyguard protect target / Witch save target / Witch poison target; kết quả phải nhất quán. Không tái sử dụng `WEREWOLF_KILL` hoặc `WITCH_POISON` làm cause giả. |

Kết luận này hợp với separation hiện hữu: protection/save là effect của night resolver, không phải một “immunity” chung trên `killPlayer`. Tuy nhiên, khi death xảy ra ngoài NightResolver, code mới phải tự bảo đảm không gọi nhầm các tập `protectedThisNight`/`savedThisNight`.

## 4. `SPOKEN_WHILE_SILENCED` nằm trong Hunter trigger mặc định và toggle qua setting

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Đúng về kiến trúc, chưa có trong default hiện tại** | `GameSettings.hunterTriggerCauses` đã là `string[]`; `DEFAULT_GAME_SETTINGS` hiện chỉ có `WEREWOLF_KILL`, `VOTE_EXECUTION`, `WITCH_POISON`. `DeathQueue::resolveOriginalDeaths` dùng `hunterTriggerCauses.includes(d.cause)` để quyết định pending Hunter prompt. [1] [10] | Nếu chỉ thêm enum và default string nhưng không đưa discussion death qua một DeathQueue-compatible path, Hunter sẽ không được prompt. Ngược lại, nếu gửi death qua DeathQueue mà không kiểm tra room phase, có thể prompt Hunter giữa discussion trong khi `GameFlowController` hiện chỉ chờ Hunter ở night/execution. Hunter prompt async có thể cạnh tranh với discussion timer và `startVoting`. | Thêm cause vào typed setting/default sau khi chốt contract; dùng một service chung cho “triggered death resolution” hoặc một method rõ ràng cho discussion death. Quy định Hunter prompt có được hiển thị/await trong discussion hay không. Nếu không muốn pause discussion, chọn policy: tự động Skip Hunter hoặc queue revenge sau khi death event hoàn tất. |

Điểm quan trọng là toggle này không chỉ là một enum/config change. `DeathQueue` có khả năng nhận cause mới, nhưng caller hiện tại là `NightResolver` và `DayService`; chưa có caller cho speech violation. Vì vậy quyết định này chỉ đúng sau khi decision 2 đã được thiết kế lại.

## 5. Cấm self-target; cho phép repeat-target tự do

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Đúng nếu áp dụng riêng cho Silent Mage** | `IRole::validateNightAction` là nơi role-specific validation; `SeerRole` và `HunterRole` tự cấm self-target. `NightActionService` chỉ áp dụng repeat-target rule cho `BODYGUARD_PROTECT`, `SEER_INSPECT`, `HUNTER_SHOOT` bằng các tracker tương ứng; một action type mới không tự động bị cấm repeat-target. [11] [12] | Nếu code mới dùng chung helper hoặc copy rule của Seer/Bodyguard mà không phân biệt action type, repeat-target có thể bị cấm ngoài ý muốn. Self-target cũng không tự bị cấm bởi engine chung; nếu quên validation ở `SilentMageRole`, role sẽ có thể tự silence chính mình. | Ghi rõ trong `SilentMageRole.validateNightAction`: target phải còn sống, target khác actor, repeat target được phép. Không thêm `lastSilencedBySilentMage` tracker trừ khi sau này cần analytics/UI. Vẫn cần idempotency một submission/action type mỗi round như các night action khác. |

Quyết định này không xung đột với state model hiện tại. `RoomState` có tracker riêng cho Bodyguard, Seer và Hunter, nhưng không có tracker generic bắt buộc cho mọi role. Tuy nhiên, “repeat tự do” không có nghĩa là cho phép duplicate callback trong cùng round; duplicate action và repeat-target qua các round là hai khái niệm khác nhau.

## 6. Người đang bị câm được công khai đầu ngày qua thông báo của bot

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Không chắc chắn** | `GameFlowController::onNightResolved` gửi `Messages.dayBegins(...)`, mute người chết, phát Seer result và sau đó start discussion. `GameFlowController` chưa có state/field nào được đọc để tạo danh sách silenced player. `RoomState`/`PlayerState` hiện cũng không có `silenced`, `silencedUntilRound` hoặc tương đương. [3] [13] | Nếu chỉ mute Telegram member mà không persist silence effect, restart hoặc resume sẽ mất danh sách. Nếu công khai danh sách nhưng không có canonical event, message có thể lệch với state. Nếu một người bị câm nhiều đêm, cần biết announce một lần hay mỗi ngày; nếu họ chết hoặc game over thì có còn công khai không. Ngoài ra, “đầu ngày” hiện được trigger trong `onNightResolved`, nên cần bảo đảm announcement xảy ra sau resolution nhưng trước discussion. | Persist silence theo round trong `RoomState` hoặc event log, ví dụ `silencedPlayerIds`/`silencedUntilRound`. Emit một event riêng hoặc đưa danh sách vào `NIGHT_RESOLVED`/day-start payload. `onNightResolved` đọc snapshot đó và gửi thông báo công khai trước `startDiscussion`. Define reset semantics: hết hiệu lực đầu round kế tiếp, hết sau một ngày, hoặc đến khi bị thay thế. |

`MuteService` có thể chặn nhiều loại quyền gửi trong Telegram, nhưng đó là transport permission, không phải engine state. Vì vậy “đang bị câm” cần được mô hình hóa trong domain nếu nó ảnh hưởng đến death khi nói và announcement. [14]

## 7. `SILENT_MAGE_SILENCE` chạy cuối night, sau Witch poison

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
 --- | --- | --- | --- |
| **Đúng về insertion point, chưa có action/resolution** | `GameSettings.nightActionOrder` là ordered list và `NightResolver` lặp qua list để dispatch action type. Default hiện kết thúc ở `WITCH_POISON`; append silence sau đó là tương thích với cơ chế order. `NightActionService` hiện kiểm tra phase, required role và mapping action-to-role trước khi persist. [1] [5] [12] | Chỉ thêm string vào `nightActionOrder` chưa đủ: resolver hiện không có `case SILENT_MAGE_SILENCE`, action callback allowlist không có action type, GameFlowController không có role-to-action mapping/prompt, và NightActionService không có action-to-role mapping. Nếu không thêm vào mọi seam, role sẽ được assign nhưng không thể submit/resolve hoặc sẽ timeout sai. | Giữ silence cuối night nếu đó là ý đồ “mọi effect khác đã xảy ra trước khi target bị câm”. Chốt rõ silence có hiệu lực cho message cùng ngày hay từ ngay sau night resolution; silence phải được ghi trước `onNightResolved` announcement. Thêm action vào typed enum, registry/mapping/keyboard/resolver, rồi test order với Witch poison và death effects. |

Đây là quyết định phù hợp với design của resolver vì thứ tự là config-driven, không hard-code. Tuy nhiên, thứ tự cũng quyết định nếu target bị Witch poison trong cùng night: cần chốt silence có được lưu cho target đã chết hay không. Khuyến nghị chỉ lưu silence cho player còn sống tại thời điểm finalize và loại bỏ target chết khỏi public silenced list.

## 8. `reactsToOwnDeath:false` và thêm 3 enum vào `enums.ts`

| Đánh giá | Căn cứ code | Rủi ro / side-effect | Điều chỉnh đề xuất |
| --- | --- | --- | --- |
| **Đúng nhưng chưa đủ** | `RoleDefinition` có đúng field `reactsToOwnDeath`; Hunter đang là role duy nhất khai báo `true`, còn các role khác khai báo `false`. `RoleId`, `NightActionType` và `DeathCause` là các enum tập trung trong `enums.ts`, hiện chưa có Silent Mage hoặc cause mới. [11] [15] | Thêm 3 enum mà không cập nhật các mapping sẽ tạo compile/runtime gap. Cụ thể: `RoleRegistry` chưa register role; `RoleDistributionStrategy` chưa biết role; `RoleAssigner` yêu cầu role registered; `NightActionService.ACTION_TYPE_TO_ROLE`, `actionCallbackHandler.NIGHT_ACTION_TYPES`, `GameFlowController.ROLE_NIGHT_ACTION` và `NightResolver` đều cần action wiring. Death cause mới cũng cần presenter/name mapping, event serialization và Hunter/death handling. | Giữ `reactsToOwnDeath:false`. Nhưng checklist code phải mở rộng: enum → role class → RoleRegistry → distribution/assigner → action-role mapping → resolver branch → RoomState silence persistence → Telegram prompt/callback → day announcement → BotPolicy/dialogue → event/death presenter → unit/integration/E2E tests. Không coi enum additions là hoàn tất role contract. |

`IRole` mô tả role mới có thể chỉ cần một class và registry, nhưng Silent Mage không còn là validation-only role: nó có night action, persistent silence state, discussion message observation, custom death cause và có thể kích hoạt Hunter. Vì vậy đây là role cần integration ở engine và Telegram, không chỉ registry registration. [11] [15]

## Khuyến nghị tổng thể

**Không nên implement nguyên trạng cả 8 quyết định.** Có thể giữ ý tưởng gameplay, nhưng cần sửa contract của decision 2 và làm rõ persistence/orchestration cho decision 1, 4, 6 và 7 trước khi code.

### Các quyết định có thể giữ

Decision 3, 5, 7 và phần metadata của 8 có thể giữ với điều kiện chúng được triển khai như các rule riêng của Silent Mage. Decision 4 cũng hợp lý về mặt cấu hình: `hunterTriggerCauses` đã được thiết kế để mở rộng bằng cause mới. Tuy nhiên, tất cả đều phụ thuộc vào việc tạo một pipeline xử lý discussion death và silence effect đúng cách.

### Các quyết định cần chỉnh trước khi giao code

1. **Sửa decision 2:** Không gán `GAME_OVER` trực tiếp từ `DISCUSSION` nếu vẫn muốn `GameStateMachine` là nguồn sự thật. Chọn thêm transition `DISCUSSION -> CHECK_WIN -> GAME_OVER/NIGHT`, hoặc thiết kế một atomic domain/application service cho discussion death nhưng vẫn giữ state-machine invariant. Phải quyết định rõ behavior khi chưa thắng: tiếp tục discussion hay kết thúc discussion ngay.
2. **Định nghĩa “current vote” lại:** Trong `DISCUSSION` chưa có ballot. Nếu death chỉ xảy ra trong discussion thì không cần “remove khỏi vote”; chỉ cần player không xuất hiện trong keyboard khi `VOTING` bắt đầu. Nếu muốn hỗ trợ death sau khi voting mở, tạo spec riêng cho ballot invalidation/re-tally.
3. **Tạo persistent silence state:** `RoomState` cần lưu ai đang bị câm, hiệu lực đến round nào và có thể truy hồi sau restart. Không dùng Redis mute permission làm nguồn sự thật duy nhất.
4. **Chuẩn hóa speech event:** Phân biệt command, callback, text, voice, sticker, GIF, caption, edited message và forwarded message. Chỉ xử lý group speech khi room đang `DISCUSSION` và người gửi còn sống.
5. **Thiết kế Hunter interaction:** Nếu `SPOKEN_WHILE_SILENCED` trigger Hunter, phải quyết định prompt ngay giữa discussion, auto-Skip hay queue xử lý. Không được chỉ thêm cause vào default setting rồi kỳ vọng `DeathQueue` tự chạy.
6. **Chốt interaction với end-of-night:** Silence chạy sau Witch poison, nhưng cần xác định target đã chết có được ghi silence không, và message đầu ngày hiển thị snapshot nào.

### Verdict giao việc code

Chỉ nên giao implementation sau khi cập nhật design thành các acceptance criteria sau:

| Acceptance criterion | Trạng thái cần đạt trước code |
| --- | --- |
| State invariant | Không có direct `DISCUSSION -> GAME_OVER` ngoài state machine hoặc service được state machine ủy quyền rõ ràng. |
| Atomic death | Mark dead, event, Hunter trigger, win check, mute và announcement có thứ tự/transaction contract rõ. |
| Speech detection | Có canonical normalized speech event và rule loại `/vote`, callback, command, non-group update. |
| Silence persistence | Silence state tồn tại trong `RoomState`/event log, có expiry/reset và survive restart. |
| Hunter | Có policy rõ cho prompt/timeout khi Hunter trigger từ discussion. |
| Voting | Không gọi “remove from current vote” khi chưa có ballot; nếu có voting-time death thì có spec riêng. |
| Night order | Silence được append sau Witch poison và test thứ tự resolution. |
| Role wiring | Enum additions đi kèm registry, distribution, mappings, resolver, presenter, BotPolicy và tests. |

## References

[1]: src/engine/domain/Room.ts "GameSettings, DEFAULT_GAME_SETTINGS và RoomState"
[2]: src/telegram/handlers/actionCallbackHandler.ts "Callback query handler cho vote và night action"
[3]: src/telegram/GameFlowController.ts "Discussion, day start, voting và execution orchestration"
[4]: src/engine/state-machine/GameStateMachine.ts "Bảng transition hợp lệ"
[5]: src/engine/night/NightResolver.ts "Night action order, protection/save và death resolution"
[6]: src/engine/DayService.ts "Day cycle, execution resolution và phase transitions"
[7]: src/engine/win-condition/WinConditionChecker.ts "Win condition theo alive werewolves/villagers"
[8]: src/engine/voting/VoteResolver.ts "Tally, abstain, tie và execution target"
[9]: src/engine/roles/BodyguardRole.ts và src/engine/roles/WitchRole.ts "Validation của protection/save"
[10]: src/engine/night/DeathQueue.ts "Hunter trigger causes và revenge chain"
[11]: src/engine/roles/IRole.ts "RoleDefinition và IRole contract"
[12]: src/engine/NightActionService.ts "Role-action mapping, validation và repeat-target rules"
[13]: src/engine/domain/Player.ts "PlayerState, killPlayer và resetVote"
[14]: src/index.ts "Group message middleware và muted-player suppression"
[15]: src/engine/domain/enums.ts và src/engine/roles/RoleRegistry.ts "Enum hiện tại và registry Phase 1"
