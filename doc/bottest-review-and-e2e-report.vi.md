# Báo cáo rà soát, cập nhật và kiểm thử `bottest`

**Phạm vi:** logic mô phỏng bot Ma Sói, command `/bottest`, luồng Telegram controller, engine night/day/vote và kiểm tra end-to-end sau cập nhật.

## 1. Kết luận tổng quan

Logic `bottest` đã được cập nhật theo hướng mô phỏng gần với một ván Ma Sói thực tế hơn: bot không còn dựa vào một tập role “biết sẵn” dùng chung cho toàn bộ bot; hành vi đã tách private knowledge theo từng bot, bổ sung suspicion công khai có giới hạn, lựa chọn mục tiêu theo trọng số thay vì random thuần túy, cho phép Skip khi bằng chứng yếu, và thêm pacing có thể cấu hình giữa các lượt bot.

Command `/bottest` cũng được làm chắc chắn hơn. Parser hiện nhận alias tiếng Việt có dấu và alias tiếng Anh, nhận role alias nhiều từ như “tiên tri”, dùng số nguyên chặt chẽ thay vì `parseInt` dễ chấp nhận chuỗi không hợp lệ, đồng thời persist `requestedRoleOverride` trước khi gửi thông báo “phòng test sẵn sàng”. Điều này loại bỏ race nhỏ giữa thông báo sẵn sàng và `/startgame`.

> **Trạng thái sau cập nhật:** toàn bộ test pass, build pass, lint pass, kiểm tra open handles pass và kịch bản E2E mới từ `/bottest` đến `GAME_OVER` pass.

## 2. Các điểm đã thay đổi

| Khu vực | Cập nhật | Mục tiêu mô phỏng |
|---|---|---|
| `src/telegram/GameFlowController.ts` | Belief riêng theo bot với `knownWerewolvesByBot` và `knownVillagersByBot` | Không để mọi bot dùng chung thông tin riêng của Tiên tri |
| `src/telegram/GameFlowController.ts` | `publicSuspicionByTarget` với giới hạn điểm | Mô phỏng niềm tin công khai thay đổi theo thông tin được phát biểu |
| `src/telegram/GameFlowController.ts` | Chọn mục tiêu bằng trọng số suspicion | Giảm hành vi random cứng và tạo ưu tiên chiến lược |
| `src/telegram/GameFlowController.ts` | Village bot có xác suất Skip 12% khi bằng chứng yếu | Cho phép hòa/không xử lý tự nhiên theo `VoteResolver` hiện có |
| `src/telegram/GameFlowController.ts` | Pacing qua `BOT_TURN_DELAY_MS`, mặc định 350 ms ngoài test | Tránh toàn bộ bot hành động đồng thời như một script duy nhất |
| `src/telegram/commands/bottest.ts` | Parser alias có normalize dấu, alias tiếng Anh và alias nhiều từ | Giảm lỗi khi dùng `/bottest 6 tiên tri`, `/bottest seer 6`, v.v. |
| `src/telegram/commands/bottest.ts` | Persist role override trước ready message | Đảm bảo `/startgame` nhìn thấy role override đã lưu |
| `tests/telegram/commands/BottestCommand.test.ts` | Regression test command | Kiểm tra parse, số bot, role override và private-chat guard |
| `tests/telegram/BottestFlow.e2e.test.ts` | E2E với engine thật + in-memory storage | Kiểm tra toàn bộ flow sau update không bị đứng hoặc chuyển phase sai |

### Hành vi thông tin và role

Các bot hiện chỉ dùng thông tin riêng phù hợp với vai trò. Tiên tri lưu kết quả soi trong knowledge riêng của chính bot; khi kết quả được công khai trong discussion, thông tin đó mới ảnh hưởng đến suspicion chung. Sói vẫn có thể nhận diện đồng đội Sói để đạt consensus, nhưng village bot không còn được cho quyền đọc role ẩn của mọi người để quyết định vote.

Cách tiếp cận này phù hợp với bản chất social deduction: game luân phiên Night/Day, Sói bí mật chọn mục tiêu, Tiên tri tạo thông tin, còn ban ngày dựa vào thảo luận và bỏ phiếu. Luật tham khảo cũng quy định Dân thắng khi loại hết Sói và Sói thắng khi số Sói còn lại bằng số Dân còn lại.[1]

### Discussion, suspicion và voting

Nghiên cứu game-theoretic về Werewolf mô hình hóa game như một trò chơi thông tin không đầy đủ giữa phe thiểu số được thông tin và phe đa số không đồng đều thông tin; vì vậy heuristic dựa trên belief phù hợp hơn việc đọc trực tiếp role thật.[2] Nghiên cứu NeurIPS về One Night Ultimate Werewolf cũng nhấn mạnh rằng chính sách thảo luận làm thay đổi belief và utility của người chơi.[3]

Vì vậy, cập nhật hiện tại không ép mọi bot vote cùng một mục tiêu. Bot có thể chọn ứng viên theo suspicion, Sói ưu tiên mục tiêu ngoài phe Sói, Tiên tri ưu tiên mục tiêu đã biết là Sói, còn bot phe Dân có thể Skip khi không đủ chứng cứ. Việc này tương thích với engine hiện tại vì `null` là một vote Skip hợp lệ, tie và no-lynch đã được `VoteResolver` hỗ trợ.

## 3. Kịch bản E2E đã thực hiện

Kịch bản `tests/telegram/BottestFlow.e2e.test.ts` dùng `InMemoryStorageAdapter`, các service engine thật, `GameOrchestrator` thật, `RoomTimerService` thật với scheduler giả lập và Telegram API giả lập. Không dùng Redis hoặc Telegram token thật nên không tạo side effect bên ngoài.

| Bước | Điều kiện kiểm tra | Kết quả |
|---|---|---|
| 1 | Gọi handler `/bottest 6 seer` trong group | Pass |
| 2 | Tạo room và thêm đúng 6 player, gồm host test bot và bot bổ sung | Pass |
| 3 | Persist `requestedRoleOverride = SEER` | Pass |
| 4 | Gọi `GameService.startGame` với host | Pass |
| 5 | Host nhận role Seer đúng override | Pass |
| 6 | `GameFlowController.onGameStarted` khởi động First Night | Pass |
| 7 | Bot thực hiện night actions, engine resolve và chuyển sang Discussion | Pass |
| 8 | Controller mở Voting, bot vote/Skip và engine resolve execution | Pass |
| 9 | Lặp các round cho đến điều kiện thắng | Pass |
| 10 | Xác nhận scheduler schedule/cancel, Telegram messages và event log | Pass |
| 11 | Xác nhận `GAME_STARTED`, `NIGHT_RESOLVED`, `EXECUTION_RESOLVED`, `WIN_CONDITION_MET`, `GAME_ENDED` | Pass |

## 4. Kết quả kiểm thử sau cập nhật

| Kiểm tra | Lệnh | Kết quả |
|---|---|---|
| Regression command/controller | `npx jest --runInBand tests/telegram/commands/BottestCommand.test.ts tests/telegram/GameFlowController.test.ts` | Pass: 2 suites, 5 tests |
| E2E bottest | `npx jest --runInBand tests/telegram/BottestFlow.e2e.test.ts` | Pass: 1 suite, 1 test |
| Full Jest suite | `npm test -- --runInBand` | Pass: 27 suites, 243 tests |
| Full Jest + open handles | `npx jest --runInBand --detectOpenHandles --forceExit` | Pass: 27 suites, 243 tests; không phát hiện lỗi open handle trong output |
| Lint | `npm run lint` | Pass |
| Production TypeScript build | `npm run build` | Pass |
| Diff whitespace | `git diff --check` | Pass |

## 5. Góp ý tiếp tục cải thiện

Các cập nhật trên giải quyết những vấn đề có tác động lớn nhất đến cảm giác “giả lập”. Tuy nhiên, để đạt mức gần người chơi thật hơn nữa, nên triển khai tiếp theo thứ tự sau.

| Ưu tiên | Đề xuất | Tác động |
|---|---|---|
| P1 | Tách `BotPolicy` thành module độc lập và thêm personality như cautious, aggressive, deceptive, quiet | Dễ test, dễ cân bằng và tránh `GameFlowController` phình to |
| P1 | Lưu `suspicion` theo từng bot thay vì chỉ một suspicion công khai chung | Mỗi bot sẽ có belief khác nhau, sát hành vi người thật hơn |
| P1 | Thêm event quan sát discussion, accusation, defense và vote history | Cho phép bot vote dựa trên hành vi, không chỉ dựa vào claim Tiên tri |
| P2 | Cho phép bot gửi nhiều lượt chat theo timeline, có phản biện và tự vệ | Discussion sẽ không còn là một câu random rồi chuyển ngay sang vote |
| P2 | Thêm confidence score và xác suất bluff cho Sói/Tiên tri giả | Tạo deception tự nhiên, tránh claim luôn đúng hoặc luôn được tin |
| P2 | Cho phép vote thay đổi trước khi chốt ballot, nếu sản phẩm muốn mô phỏng tranh luận thực tế hơn | Hiện `DayService` khóa một vote mỗi người; cần thay đổi engine contract và idempotency |
| P3 | Chạy Monte Carlo nhiều seed để đo win-rate theo cấu hình role | Phát hiện bot quá mạnh hoặc quá yếu thay vì chỉ xác nhận flow không crash |
| P3 | Thêm telemetry: độ dài discussion, tỷ lệ Skip, vote accuracy, số lần đổi suspicion | Có dữ liệu để cân bằng bot bằng số liệu thực tế |

## 6. Giới hạn của vòng xác minh

Vòng E2E đã kiểm tra đầy đủ flow logic trong process: command, storage, role assignment, night action, Witch-phase contract qua orchestrator, discussion/voting controller, execution, win condition và event log. Các test Telegram callback và engine hiện có cũng được chạy lại trong full suite.

Vòng này **không gửi request đến Telegram thật và không kết nối Redis production**. Do đó, trước khi deploy thực tế vẫn cần smoke test riêng với group test, Redis reachable, `/health`, quyền mute và callback button. Không nên dùng room production để kiểm tra role override hoặc bot injection.

## References

[1]: https://playwerewolf.co/pages/rules "WEREWOLF by Stellar Factory — How to Play"

[2]: https://arxiv.org/html/2408.17177v1 "Shitong Wang — Optimal Strategy in Werewolf Game: A Game Theoretic Perspective"

[3]: https://neurips.cc/virtual/2024/poster/96856 "Jin et al. — Learning to Discuss Strategically: A Case Study on One Night Ultimate Werewolf"
