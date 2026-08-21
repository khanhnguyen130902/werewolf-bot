# Silent Mage — Design Audit Vòng 2

**Phạm vi:** Kiểm tra 5 rủi ro mới trong mục 13.2 và lựa chọn phương án cho quyết định #2 “Thời điểm hành động”.

**Nguyên tắc:** Đây là audit đọc/đối chiếu. Không tạo role Silent Mage, không sửa `RoleRegistry`, không thay đổi source file nào trong repository.

## Tóm tắt kết luận

| Điểm | Kết luận | Nhận định ngắn |
| --- | --- | --- |
| 1 | **Không chắc chắn** | Có race window: room đã ở `DISCUSSION` trước khi thông báo group được gửi xong; code hiện chưa có enforcement speech nên chưa thể bảo đảm thứ tự mới đề xuất. |
| 2 | **Không chắc chắn** | Death list hiện được announce từ night result, nhưng chưa có silence announcement. Khi thêm silence, bắt buộc lọc target đã chết trên snapshot cuối cùng. |
| 3 | **Đúng theo pattern hiện tại** | NightResolver xử lý action đã submit độc lập với việc caster chết sau đó; hành vi khớp Seer/Witch, không có ngoại lệ chết-caster trong resolver hiện tại. |
| 4 | **Sai nếu kỳ vọng bottest đã mô phỏng im lặng** | `BotPolicy` và `bottest.ts` chưa có silence state/`canSpeak`; bot discussion chỉ lọc alive, không lọc silenced. |
| 5 | **Đúng** | Callback ballot đi qua `callback_query`, tách khỏi `ctx.message` middleware; silence speech không nên chặn vote callback. Cần giữ phân loại này khi thêm enforcement. |

## 1. Public announcement phải hoàn tất trước khi enforcement tính vi phạm

| Đánh giá | Căn cứ code | Rủi ro nếu bỏ qua | Đề xuất điều chỉnh |
| --- | --- | --- | --- |
| **Không chắc chắn** | `GameFlowController::startDiscussion` gọi `dayService.startDiscussion(roomId)` trước, sau đó `await bot.telegram.sendMessage(...Messages.discussionStarted(...))`, rồi mới `scheduleBotDiscussion` và schedule timer. `GameStateMachine` đã chuyển room sang `DISCUSSION` ngay ở `DayService::startDiscussion` trước khi Telegram announcement hoàn tất. [1] [2] | Nếu thêm speech enforcement ở middleware/update handler, một group message có thể tới sau khi state đã là `DISCUSSION` nhưng trước khi `sendMessage` hoàn tất. Message đó có thể bị tính là vi phạm dù người chơi chưa nhìn thấy thông báo công khai. Ngược lại, nếu enforcement bắt đầu trước khi announcement gửi thành công, người chơi có thể bị xử lý trong khi Telegram đang lỗi hoặc chậm. Timer cũng là async và được schedule sau announcement, nhưng không loại bỏ window giữa state transition và message delivery. | Tách lifecycle thành hai bước rõ ràng: `DISCUSSION_OPENING`/`discussionEnforcementReady=false`, gửi announcement thành công, sau đó atomic bật enforcement và bắt đầu timer; hoặc lưu một `discussionAnnouncementSentAt/ready` flag trong RoomState và speech handler chỉ xử lý khi flag đã bật. Không dùng thứ tự gọi `await` trong `GameFlowController` làm guarantee giao thức nếu state đã đổi trước đó. |

Hiện code chưa có speech violation handler nên race này chưa xảy ra trong runtime hiện tại; đây là rủi ro trực tiếp khi thêm feature. `scheduleBotDiscussion` tự kiểm tra `room.gameState === DISCUSSION`, nhưng check này chỉ bảo vệ bot timer, không phải enforcement cho message người dùng. [1]

**Kết luận thiết kế:** Quyết định “announcement xong trước enforcement” là đúng về sản phẩm, nhưng chưa được engine bảo đảm. Cần một cờ readiness hoặc transient lifecycle state có tính durable/atomic.

## 2. Target đã chết trong night resolution không được announce/áp silence

| Đánh giá | Căn cứ code | Rủi ro nếu bỏ qua | Đề xuất điều chỉnh |
| --- | --- | --- | --- |
| **Không chắc chắn** | `NightResolver::resolveWithoutHunterRevenge` tạo `seerResults`, `depth0Deaths` và pending Hunter từ submissions; `applyHunterRevengeAndFinalize` mới gọi `killPlayer` và trả room snapshot đã cập nhật. `GameFlowController::onNightResolved` nhận `room` và `deaths`, rồi tạo `deathsWithNicknames` từ death result để gửi `Messages.dayBegins`. Chưa có silence list hoặc silence announcement trong flow hiện tại. [3] [4] | Nếu Silent Mage target một người còn sống khi submit nhưng target chết bởi Werewolf/Witch/Hunter trong cùng night, một implementation naïve có thể vẫn lưu target vào public silence list và thông báo “đang bị câm” đầu ngày. Điều đó tạo state mồ côi và làm target đã chết bị áp enforcement ở các message sau. Cũng có rủi ro dùng room snapshot trước finalize thay vì room sau death queue. | Finalize deaths trước, sau đó lọc silence effects bằng snapshot cuối: chỉ giữ target có `player.alive === true`. Nếu target chết trong cùng night, silence action có thể vẫn là action hợp lệ đã resolve nhưng **không tạo active silence**. Announcement day-start phải được tạo từ room sau finalize, không từ danh sách target raw trước death queue. |

Cần phân biệt hai loại thông báo: `Messages.dayBegins` hiện đang công khai người chết, nên việc nhìn thấy tên người chết ở đó là đúng logic; rủi ro nằm ở thông báo silence mới. Code hiện không có chỗ “nhầm” công khai silence cho người chết vì chưa có silence feature, nhưng những field/array mới nếu không lọc sẽ tạo lỗi này. `onNightResolved` cũng gọi mute người chết trước khi gửi day message; mute transport không nên được dùng làm nguồn xác định active silence. [4] [5]

**Acceptance criterion:** Sau night finalize, `activeSilencedIds` phải là tập con của `alivePlayerIds`; mọi target đã chết bị loại trước khi announcement và trước khi đăng ký speech enforcement.

## 3. Silent Mage chết cùng đêm sau khi đã submit silence

| Đánh giá | Căn cứ code | Rủi ro nếu bỏ qua | Đề xuất điều chỉnh |
| --- | --- | --- | --- |
| **Đúng theo pattern hiện tại** | `NightActionService::submitNightAction` kiểm tra player còn sống và role/action hợp lệ **tại thời điểm submit**, sau đó lưu vào `room.pendingNightActions`. `NightResolver::resolveWithoutHunterRevenge` xử lý các submissions theo `nightActionOrder` và không lọc action theo alive status của caster ở thời điểm cuối night. Seer result được tính trước DeathQueue; Witch save/poison cũng được xử lý từ pending actions. `applyHunterRevengeAndFinalize` sau đó mới kill players/reset flags. [3] [6] | Nếu code mới thêm điều kiện “caster phải còn sống khi finalize”, behavior sẽ khác Seer/Witch và có thể làm mất silence action hợp lệ khi Mage bị Sói/poison giết cùng đêm. Nếu không có state snapshot rõ, silence có thể vẫn được persist cho target đã chết hoặc được áp dụng sau game over. | Giữ nguyên pattern: action hợp lệ đã submit được resolve độc lập với số phận caster trong cùng night. Sau khi resolve, chỉ lọc **target effect** theo alive state cuối cùng; không lọc theo caster alive. Ghi rõ ngoại lệ: nếu action submit sau khi caster đã chết thì bị `DeadPlayerActionError`; nếu submit trước khi chết thì action vẫn final. |

Đây là cùng nguyên tắc mà source hiện mô tả cho Seer: Seer bị giết cùng night vẫn nhận kết quả soi vì kết quả được tính trước death queue. `NightResolver` không có branch loại pending action của caster đã chết. Do đó Silent Mage nên theo pattern này để tránh role-specific inconsistency. [3] [6]

## 4. BotPolicy/bottest có model “im lặng” không?

| Đánh giá | Căn cứ code | Rủi ro nếu bỏ qua | Đề xuất điều chỉnh |
| --- | --- | --- | --- |
| **Sai nếu kỳ vọng simulation hiện tại đã hỗ trợ** | `BotPolicy` hiện có `BotBeliefState`, `BotObservationType` chỉ gồm `DISCUSSION`, `ACCUSATION`, `DEFENSE`, `VOTE`, cùng personality và target selection; không có `silenced`, `silencedUntilRound`, `canSpeak` hoặc speech violation observation. `GameFlowController::simulateRandomBotChat` lọc `alive && isTestBot`, sau đó gửi message; không kiểm tra silence. `bottest.ts` chỉ parse role alias, tạo room, thêm bot và persist role override, không mô phỏng behavior im lặng. [7] [8] | Test E2E có thể chạy qua discussion mà bot silenced vẫn phát message, làm sai cả hai hướng: không kiểm thử được violation/death, hoặc tạo false positive nếu test chỉ đếm số message. Bot không biết mình bị câm sẽ tiếp tục tạo `DISCUSSION` observations và chat; BotPolicy cũng không ghi được `SPOKEN_WHILE_SILENCED`. Các stress/telemetry baseline hiện có thể thay đổi không kiểm soát khi thêm role. | Thêm simulation contract trước khi bật role: BotPolicy state lưu `silencedUntilRound`/active silence, `canSpeak(room, player)` và `recordSpeechAttempt`. `GameFlowController` phải bỏ qua scheduled chat của bot bị câm. Nếu thiết kế nói “bot thử nói khi bị câm để trigger death”, cần một mode test rõ ràng cho deliberate violation; không để random dialogue vô tình tạo death. Bổ sung observation type `SPEECH_ATTEMPT` hoặc event domain riêng để E2E assert được. |

`BotPolicy::recordObservation` hiện chỉ tính telemetry cho bốn nhóm nói/claim/vote; việc thêm một role có violation death nhưng không thêm observation sẽ khiến metrics không giải thích được vì sao player chết. `bottest.ts` cũng không có alias Silent Mage, nên test room chưa thể chọn role này qua command. Đây là thiếu hụt test harness, không chỉ thiếu dialogue.

## 5. Callback query vote có tách biệt khỏi speech handler không?

| Đánh giá | Căn cứ code | Rủi ro nếu bỏ qua | Đề xuất điều chỉnh |
 --- | --- | --- | --- |
| **Đúng với code hiện tại** | `src/index.ts` middleware speech/message chỉ nhánh khi có `ctx.message` trong group/supergroup. `actionCallbackHandler.ts::registerActionCallbackHandler` đăng ký `bot.on('callback_query')` riêng; nhánh `parsed.actionType === 'VOTE'` gọi `DayService::submitVote`, answer callback query và cập nhật keyboard. `actionCallbackHandler` không đi qua speech-message path. [5] [9] | Rủi ro chỉ xuất hiện khi thêm enforcement quá rộng ở middleware chung, ví dụ chặn mọi update của user đang silenced hoặc kiểm tra mute theo `ctx.from` mà không phân biệt `ctx.message` với `ctx.callbackQuery`. Khi đó người bị câm có thể không gửi được ballot, trái với quyết định “câm chỉ cấm nói”. Một rủi ro khác là dead player vẫn không vote được vì `DayService::submitVote` kiểm tra `voter.alive`, đây là anti-cheat đúng, không phải speech blocking. | Giữ callback vote ở handler riêng và thêm test invariant: silenced-but-alive player vẫn có thể callback vote; dead player bị `DeadPlayerActionError`; text/voice/sticker trong group mới đi qua speech enforcement. Không đưa callback query vào `SpeechObservation`, không delete/deny callback chỉ vì active silence. |

`/vote` command vẫn khác callback ballot: command mở `DISCUSSION -> VOTING`, còn callback `action:VOTE:<target>` cast ballot. Đây là phân biệt cần giữ trong test và documentation. `DayService::submitVote` chỉ nhận vote khi `gameState === VOTING` và target còn sống; không có code nào đọc speech/mute state cho callback. [2] [9]

## Khuyến nghị phương án A/B cho quyết định #2

### Phương án A — Thêm transition qua `CHECK_WIN`

| Khía cạnh | Đánh giá |
| --- | --- |
| Tính nhất quán | Cao hơn: mọi terminal outcome vẫn đi qua state machine và có thể emit `PHASE_CHANGED`, `WIN_CONDITION_MET`, `GAME_ENDED` theo một contract chính thức. |
| Chi phí code | Trung bình–cao, vì `DISCUSSION -> CHECK_WIN` không đủ cho trường hợp chưa thắng. Cần thêm return path rõ ràng: `CHECK_WIN -> DISCUSSION` hoặc `CHECK_WIN -> VOTING`, hoặc tạo state/micro-phase riêng. |
| Tác động timer | Có thể hủy discussion timer trước resolution, sau đó start timer đúng phase; cần idempotency/lock tránh timer và speech event cùng resolve. |
| Tác động restart | Tốt hơn nếu state persisted hợp lệ; startup overdue logic có thể được mở rộng theo state mới thay vì đoán từ `DISCUSSION`. |
| Rủi ro | Nếu chỉ thêm `DISCUSSION -> CHECK_WIN` nhưng để `CHECK_WIN -> NIGHT` khi chưa thắng, game sẽ bỏ qua phần voting còn lại. Nếu thêm direct `DISCUSSION -> GAME_OVER` thì lại mất ý nghĩa của `CHECK_WIN`. |

### Phương án B — Giữ `gameState = DISCUSSION`, xử lý application service atomic

| Khía cạnh | Đánh giá |
| --- | --- |
| Tính nhất quán | Thấp nếu game đã thắng: room vẫn ở `DISCUSSION` nhưng cần thể hiện terminal `GAME_OVER`; nếu mutate thẳng `gameState=GAME_OVER` thì bypass `GameStateMachine::assertTransition`. |
| Chi phí code | Có vẻ thấp lúc đầu vì không sửa transition table, nhưng sẽ phải thêm cờ terminal/lock/timer cancellation/restart handling và event semantics riêng. |
| Tác động timer | Cao: discussion timer đã được schedule; service phải hủy timer và ngăn `startVoting` chạy sau khi room đã kết thúc. |
| Tác động restart | Cao: `index.ts` hiện resume room ở `DISCUSSION` bằng cách gọi `startVoting`; một room thắng nhưng vẫn lưu `DISCUSSION` có thể bị resume nhầm sang voting. |
| Rủi ro | Có hai nguồn sự thật: state machine nói room còn discussion, còn application service nói match đã game over. Race giữa speech event, discussion timeout, bot chat và `/vote` dễ tạo state/event không nhất quán. |

### Kết luận lựa chọn

**Khuyến nghị chọn A, nhưng không implement A theo nghĩa chỉ thêm một cạnh rồi xong.** A an toàn hơn về kiến trúc vì giữ `GameStateMachine` là nguồn sự thật và không tạo “game over ẩn” bên trong một room vẫn mang state `DISCUSSION`. B rẻ hơn trên diff ban đầu nhưng không an toàn: đặc biệt `src/index.ts` hiện có logic resume overdue `DISCUSSION -> startVoting`, nên một match đã thắng nhưng vẫn lưu `DISCUSSION` có thể bị mở voting lại sau restart. [1] [10]

Biến thể A tối thiểu cần chốt trước code là:

```text
DISCUSSION -> CHECK_WIN
CHECK_WIN -> GAME_OVER       nếu Silent Mage death tạo điều kiện thắng
CHECK_WIN -> DISCUSSION      nếu chưa thắng và discussion tiếp tục
DISCUSSION -> VOTING        khi discussion kết thúc bình thường
```

Nếu sản phẩm muốn kết thúc discussion ngay sau một non-terminal death rồi chuyển thẳng sang voting, có thể dùng `CHECK_WIN -> VOTING`, nhưng đó là một transition mới cần nêu rõ trong contract. Không nên dùng `CHECK_WIN -> NIGHT` cho non-terminal discussion death vì sẽ bỏ qua ballot của ngày hiện tại. Một alternative sạch hơn là thêm một micro-state `DISCUSSION_RESOLUTION`, nhưng nó không còn là A tối giản và cần cập nhật timer/resume/event tooling.

## Khuyến nghị tổng thể: đã đủ điều kiện giao code chưa

**Chưa đủ điều kiện giao code production.** Đã đủ để viết test design/prototype riêng, nhưng còn 5 blocker cần chốt:

| Blocker | Điều phải chốt |
| --- | --- |
| Speech enforcement gate | Announcement completion flag hoặc transient opening state; không tính vi phạm trong race window. |
| Discussion death transition | Chọn A mở rộng với non-terminal return path; không dùng B kiểu “game over ẩn”. |
| Silence persistence | Field/state lifetime, reset/expiry, target-dead filtering và restart behavior. |
| Bot simulation | BotPolicy `canSpeak`, deliberate violation mode, telemetry/event cho speech attempt và alias `/bottest` cho Silent Mage. |
| Hunter trigger | Prompt/timeout/queue policy khi `SPOKEN_WHILE_SILENCED` trigger trong discussion. |

Sau khi chốt 5 blocker trên, có thể giao implementation theo thứ tự: domain enums/state contract → atomic discussion-death service/state machine → NightResolver silence effect → Telegram speech normalization/enforcement → BotPolicy/bottest → Hunter interaction → E2E/stress tests.

## References

[1]: src/telegram/GameFlowController.ts "Day start, discussion timer, bot discussion và voting orchestration"
[2]: src/engine/DayService.ts "startDiscussion, startVoting và day lifecycle"
[3]: src/engine/night/NightResolver.ts "Night action resolution, Seer result và death finalization"
[4]: src/engine/domain/Player.ts "PlayerState, killPlayer và alive state"
[5]: src/index.ts "Group message middleware và command/callback registration"
[6]: src/engine/NightActionService.ts "Submit night action, alive check, role validation và pending actions"
[7]: src/telegram/BotPolicy.ts "Bot belief, observation telemetry, personality và target selection"
[8]: src/telegram/commands/bottest.ts "Bottest parser, room creation, bot injection và role override"
[9]: src/telegram/handlers/actionCallbackHandler.ts "Callback query vote/ballot và night action handler"
[10]: src/engine/state-machine/GameStateMachine.ts "Transition table và terminal state contract"
[11]: src/engine/win-condition/WinConditionChecker.ts "Win condition pure checker"
[12]: src/engine/voting/VoteResolver.ts "Vote tally, abstain, tie và execution result"
[13]: src/engine/night/DeathQueue.ts "Hunter trigger causes và revenge chain"
[14]: src/engine/domain/Room.ts "GameSettings, DEFAULT_GAME_SETTINGS và RoomState"
[15]: src/engine/roles/IRole.ts "RoleDefinition và IRole contract"
