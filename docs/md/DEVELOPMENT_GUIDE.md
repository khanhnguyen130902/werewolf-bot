# Development Guide

> **Audience:** developer, QA engineer, maintainer và technical lead  
> **Approach:** thay đổi nhỏ, có test, giữ engine độc lập Telegram và bảo vệ state bằng optimistic locking  
> **Release rule:** không coi behavior ngoài source/test là contract đã xác nhận.

## 1. Mục tiêu của repository

Repository được tổ chức như một modular monolith: một process chạy Telegram bot, nhưng game engine được chia thành các module có boundary rõ. Mục tiêu của cấu trúc này là cho phép thay đổi role, action, timer và luật mà không kéo toàn bộ logic vào Telegram handler hoặc Redis adapter.

Khi làm việc với repository, developer nên coi `src/engine` là domain/application core, `src/telegram` là transport/presentation adapter và `src/infrastructure` là implementation detail. Việc đảo ngược dependency làm tăng rủi ro test khó chạy, state khó recovery và behavior khác nhau giữa local với production.

## 2. Source-of-truth hierarchy

Khi các nguồn mô tả khác nhau, ưu tiên theo thứ tự sau:

| Priority | Source | Cách sử dụng |
|---:|---|---|
| 1 | Code đang được build | Xác định behavior runtime thực tế. |
| 2 | Tests đang pass | Xác định invariant và expected edge cases đã được tự động hóa. |
| 3 | `.env.example` và package scripts | Xác định setup/developer contract. |
| 4 | Documentation Pack này | Giải thích code cho người dùng và maintainer. |
| 5 | Audit/report cũ | Chỉ dùng làm lịch sử, không dùng làm rule nếu mâu thuẫn. |

## 3. Repository map

```text
src/index.ts                         process bootstrap and HTTP health
src/config/config.ts                 environment parsing
src/engine/domain                    RoomState, PlayerState, enums
src/engine/roles                     IRole and role implementations
src/engine/role-distribution          role-count strategies and assignment
src/engine/state-machine               legal game transitions
src/engine/night                      night resolver and death queue
src/engine/voting                     vote resolver
src/engine/win-condition               winner checker
src/engine/ports                      neutral interfaces and test seams
src/engine/*Service.ts                 application use cases
src/infrastructure/redis               production persistence
src/infrastructure/scheduler           BullMQ adapter
a src/infrastructure/logging           Winston logger
src/telegram/commands                  public commands
src/telegram/handlers                  callback query transport
src/telegram/presenters                messages, keyboards, translation
src/telegram/GameFlowController.ts     Telegram/application orchestration
tests/engine                           engine and state regression
tests/telegram                        commands, callbacks, mute and flow tests
```

## 4. Local setup

Tạo `.env` từ `.env.example`. Cần `TELEGRAM_BOT_TOKEN` và `REDIS_URL`; các biến còn lại có default. Cài dependency và chạy development mode:

```bash
npm install
npm run dev
```

Để chạy compiled output:

```bash
npm run build
npm start
```

Kiểm tra:

```bash
curl http://localhost:3001/health
```

Không có dashboard/login service trong runtime hiện tại; không dùng tài liệu legacy về port 3000 hoặc `DASHBOARD_*` làm setup.

## 5. Engineering invariants

Các invariant sau phải được bảo toàn khi sửa code:

| Invariant | Consequence nếu vi phạm |
|---|---|
| Room mutation qua CAS version | Join/action/vote/timer có thể ghi đè nhau. |
| Player session là single-room | Một user có thể xuất hiện trong hai room cùng lúc. |
| Player sống mới action/vote | Dead player có thể tác động match. |
| Action ID được deduplicate | Double-click/retry có thể tạo double effect. |
| Ballot ID kiểm tra callback | Nút ballot cũ có thể ghi vote vào round mới. |
| State transition qua `GameStateMachine` | Room có thể nhảy phase bất hợp lệ. |
| Timer callback có guard | Callback cũ có thể resurrect hoặc advance room sai. |
| Telegram delivery không rollback giả | Flow có thể bị stuck chỉ vì một message fail. |
| Legacy optional fields có default | Room cũ không đọc được sau deploy. |

## 6. Adding a role

Để thêm một role, thực hiện theo thứ tự:

1. Thêm `RoleId`, action type/death cause nếu cần vào `enums.ts`.
2. Tạo class triển khai `IRole` với `RoleDefinition` và pure target validation.
3. Register role trong registry factory.
4. Thêm role vào distribution strategy nếu role được auto-select.
5. Thêm action-to-role mapping trong `NightActionService`.
6. Thêm resolution case/state field nếu role có effect.
7. Thêm player-facing labels/descriptions/buttons.
8. Thêm unit, integration và negative tests.

Role class không nên tự ghi Redis hoặc gọi Telegram. Nếu ability kéo dài qua nhiều phase, phải định nghĩa explicit scope: round, night, discussion cycle hay match.

## 7. Adding a night action

Một action cần có action ID, actor ID, target ID nullable nếu skip, current round và action type. `NightActionService` phải kiểm tra:

```text
player exists → player alive → phase valid → role valid
→ target valid → no duplicate → CAS save → event publish
```

Nếu action có rule đặc thù, đặt validator trong role hoặc service chuyên biệt. Witch là pattern hiện tại cho hai action có inventory riêng. Resolution phải xử lý action theo `nightActionOrder`, đồng thời có behavior rõ khi target đã chết hoặc effect bị chặn.

## 8. Adding a phase or transition

Thêm transition trước trong `GameStateMachine.ts`, sau đó cập nhật tất cả caller và test. Một phase mới cần xác định player-facing message, timer, timeout behavior, recovery behavior và terminal/branch behavior.

Đặc biệt với phase async, không giữ lock trong lúc chờ Telegram. Dùng version snapshot và finalize guard. Callback sau restart hoặc sau phase change phải được coi là stale cho đến khi chứng minh còn hợp lệ.

## 9. Telegram handlers

Command handler chỉ nên parse context và gọi service. Không đặt business rule mới trong handler nếu rule cần áp dụng cho các transport khác. Callback handler phải decode payload an toàn, lookup session và để service quyết định legality.

Message middleware có thứ tự quan trọng: group mute/dead-message handling, Silence Gate và sau đó command/normal update chain. Callback query không phải group speech và không đi qua speech enforcement.

## 10. Persistence changes

Khi thêm field vào `RoomState` hoặc `PlayerState`, dùng default khi đọc record cũ. Khởi tạo field mới ở room factory và match start. Không đổi Redis key hoặc serialized shape mà không viết migration/backward-compatibility test.

`RedisStorageAdapter.saveRoom` phải giữ Lua CAS. Mọi `appendEvents` chỉ thực hiện sau save thành công. Không dùng Redis read-modify-write cho critical mutation nếu không có version check.

## 11. Tests

### 11.1 Test pyramid

| Level | Mục tiêu | Ví dụ |
|---|---|---|
| Unit | Pure role, resolver, state machine, error translation | `NightResolver`, `VoteResolver`, role validation |
| Service integration | Service + in-memory storage + event bus | `NightActionService`, `DayService`, `RoomService` |
| Adapter integration | Redis CAS, timer key, event list | `RedisStorageAdapter` |
| Telegram flow | Handler/presenter/mute orchestration | command and callback tests |
| E2E simulation | Full match lifecycle | `/bottest` and orchestrator flow |

### 11.2 Commands

```bash
npm run lint
npm run build
npm test -- --runInBand
npx jest tests/engine/NightResolver.test.ts --runInBand --forceExit
```

A test that fails because of an open handle must be separated from an assertion failure. Use focused suites and inspect process handles before labeling a gameplay regression.

## 12. Test case design

Mỗi feature cần happy path, invalid phase, invalid target, dead actor, duplicate request, stale request, concurrent mutation, timeout và delivery failure. Role feature cần test interaction với every relevant protector/killer and win condition. Timer feature cần test early completion, delayed callback, restart recovery and terminal state.

For speech Silence Gate, test message kinds TEXT, VOICE, STICKER, GIF and ANIMATION; test command exclusion; test opening-before-enforcement ordering; test target death before activation; test immediate `CHECK_WIN`; and test that vote callback remains independent.

## 13. Review checklist

| Review question | Pass condition |
|---|---|
| Scope | Change is limited to named module and no unrelated reset/reformat. |
| State | All writes use expected version and preserve optional fields. |
| Events | Event payload matches state mutation and is emitted once. |
| Timer | Old callback cannot mutate current phase. |
| Telegram | Delivery failure is handled; secrets are not logged. |
| UX | Error maps to a stable Vietnamese message. |
| Tests | New behavior and unhappy paths are covered. |
| Operations | Build, lint and relevant tests pass. |

## 14. Debugging playbook

Khi command không phản hồi, trace theo thứ tự update receipt → session lookup → room lookup → phase guard → service error → Telegram reply. Khi phase bị stuck, kiểm tra Redis room version, gameState, round, timer deadline và BullMQ worker. Khi thấy `INVALID_PHASE_ACTION`, không kết luận là user error cho đến khi loại trừ stale timer/callback.

Khi Telegram report group “bị ẩn”, kiểm tra mute marker, room status, bot permissions và member status. Bot hiện không có API hide/delete group; message deletion và restriction chỉ có thể làm trải nghiệm trông như group không hoạt động.

## 15. Change management

Không dùng `git reset --hard` để clean repository. Không commit generated `dist`, coverage, runtime log hoặc stress JSON trừ khi project owner yêu cầu lưu artifact. Không commit secrets. Thay đổi source cần được review riêng với thay đổi docs.

## References

[1]: ../../src/engine/ports/StoragePort.ts "Storage abstraction"
[2]: ../../src/engine/state-machine/GameStateMachine.ts "State transitions"
[3]: ../../src/engine/NightActionService.ts "Night action pipeline"
[4]: ../../src/engine/DayService.ts "Day and voting pipeline"
[5]: ../../src/telegram/handlers/actionCallbackHandler.ts "Callback transport"
[6]: ../../tests "Regression tests"

## 16. Decisions chưa xác định

Các câu hỏi về hosting provider, TLS/reverse proxy, SQL database, web admin login, event-log retention dài hạn, SLA/SLO và RPO/RTO chưa có contract trong source hiện tại. Developer không được tự tạo implementation dựa trên suy đoán; cần mở decision record hoặc yêu cầu product/deployment owner xác nhận trước.

## 17. Definition of Done cho thay đổi kỹ thuật

Một thay đổi chỉ được coi là hoàn thành khi code compile, lint pass, test liên quan pass, backward compatibility đã được xem xét, log/metrics đủ để vận hành, tài liệu được cập nhật và giới hạn behavior được nêu rõ. Nếu test suite giữ open handle hoặc môi trường external không sẵn sàng, kết quả phải được phân loại minh bạch thay vì báo PASS toàn bộ.

> **CHƯA XÁC ĐỊNH:** Hosting provider, TLS/reverse proxy, SQL database, web admin login, event-log retention, SLA/SLO và RPO/RTO chưa phải contract của source hiện tại.
