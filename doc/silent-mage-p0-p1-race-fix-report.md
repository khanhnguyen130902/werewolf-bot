# Silent Mage — P0/P1 Race Fix Implementation Report

**Branch:** `feature/silent-mage`  
**Scope:** ballot token, role action discovery, timer lifecycle/generation guard, stale Hunter prompt, ballot presentation idempotency và event commit ordering.

## 1. Các thay đổi đã triển khai

### Ballot token và stale callback

`RoomState` hiện persist `ballotId`. Khi `DayService.startVoting()` hoặc discussion speech transition tạo `VOTING`, service sinh ballot identity mới. `buildVoteKeyboard()` nhúng ballot token vào callback data; parser hỗ trợ cả format mới và format legacy cho non-ballot actions.

`actionCallbackHandler` truyền `parsed.ballotId` vào `DayService.submitVote()`. Nếu callback chứa ballot token khác với ballot hiện tại, engine ném `STALE_BALLOT` và Telegram trả thông báo yêu cầu dùng keyboard mới. Callback legacy không có token bị reject khi room đang có ballot; trusted internal/service call không truyền `ballotId` vẫn được giữ backward-compatible.

### Silent Mage trong early-night completion

`GameOrchestrator.roleHasNightAction()` hiện bao gồm `SILENT_MAGE`, đồng thời giữ nguyên `HUNTER` semantics hiện hữu. Vì vậy `allNightActionsSubmitted()` không được coi night đã đủ action khi Silent Mage còn chưa submit silence.

### Timer lifecycle/generation guard

Timer job payload hiện mang phase identity:

| Phase | Token |
| --- | --- |
| Night | `round`, `nightPhase` |
| Discussion | `discussionCycleId`, `gameState` |
| Voting | `ballotId`, `round`, `gameState` |

`DISCUSSION_TIMEOUT` chỉ xử lý khi room đang `DISCUSSION`, lifecycle là `ACTIVE`, enforcement đã ready và `discussionCycleId` khớp. `VOTING_TIMEOUT` chỉ xử lý khi `ballotId` và round khớp. Timer stale trở thành no-op có debug log; race thua `startVoting()` được bắt và không phát sinh unhandled rejection.

### Hunter stale prompt

Speech violation có Hunter prompt được finalize chỉ khi snapshot version, game state và discussion cycle vẫn khớp sau khi prompt trả về. Nếu room đã bị mutation hoặc chuyển phase, decision stale bị reject thay vì tạo Hunter death/phases side effect trên snapshot cũ.

### Presentation idempotency

`GameFlowController` có per-room/per-ballot presentation guard để tránh duplicate voting announcement, duplicate bot vote scheduling và duplicate resolution side effect trong cùng process. Guard được xóa nếu Telegram presentation thất bại để cho phép retry.

### Event commit ordering metadata

Domain event có `commitVersion` tùy chọn. Các event batch từ `DayService` được stamp bằng saved room version sau optimistic commit trước khi append/publish. Audit/replay consumer có thể dùng trường này để sắp xếp hoặc deduplicate batch khi delivery bất đồng bộ.

### Match reset

`GameService.startGame()` xóa `ballotId`, discussion lifecycle, discussion cycle, readiness và silence metadata của ván trước để callback cũ không thể tái sử dụng trong match mới.

## 2. Test results

| Gate | Kết quả |
| --- | --- |
| TypeScript compiler (`tsc --noEmit`) | PASS |
| Engine full regression | PASS — 20 suites, 224 tests |
| P0/P1 targeted suites | PASS — 5 suites, 39 tests ở lần chạy đầy đủ targeted |
| Timer + ballot contract | PASS — 9 tests |
| Telegram unit/regression, bỏ qua 2 E2E stress đã chạy riêng | PASS — 13 suites, 39 tests |
| BottestFlow E2E | PASS |
| BottestStress100 E2E | PASS ở lần chạy trước và không bị ảnh hưởng bởi các thay đổi cuối cùng ngoài ballot/timer compatibility |
| `git diff --check` | Cần chạy lại trước merge |

Đã sửa một lỗi phát hiện trong quá trình test: enforce ballot token ban đầu làm các trusted internal service tests không có token bị fail. Contract cuối phân biệt `undefined` trusted internal call với `null`/token từ callback; callback stale vẫn bị reject mà service flow cũ không bị phá.

## 3. Phần chưa thể chứng minh hoàn toàn trong sandbox

Timer guard và ballot token đã được kiểm thử bằng fake scheduler/in-memory storage; cần thêm canary Redis/BullMQ thật để xác nhận payload không bị mất qua serialization và worker restart. Presentation guard hiện là per-process; nếu chạy nhiều bot worker đồng thời, cần chuyển guard sang Redis `SETNX` hoặc persisted presentation record.

`commitVersion` giúp consumer phát hiện/sắp xếp event batch nhưng chưa biến state save và event append thành một transaction/outbox nguyên tử. Nếu yêu cầu audit không mất event khi Redis append fail, bước tiếp theo vẫn là transactional outbox với event-id deduplication.

Full Jest command gồm toàn bộ thư mục có thể vượt timeout vì các suite integration/E2E giữ open handles; engine full và Telegram suite phân tách đã pass. Trước merge cần chạy trong CI có timeout/worker policy rõ ràng.

## 4. Kết luận

Các P0 trọng tâm đã được xử lý ở code và có test tương ứng: ballot stale callback, Silent Mage action discovery, stale discussion/voting timer và stale Hunter prompt. Các P1 chính đã được gia cố bằng presentation idempotency và commit-version metadata. Trạng thái hiện tại là **ready for controlled canary**, chưa nên coi là production-wide ready cho đến khi Redis/BullMQ thật, multi-worker guard và transactional outbox được xác nhận.
