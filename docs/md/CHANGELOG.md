# CHANGELOG

> **Versioning status:** repository chưa có release version chính thức. Các mốc dưới đây dùng ngày và phạm vi thay đổi, không tự tạo semantic version.

## [2026-08-25] — Documentation Pack refresh

### Added

Bộ Documentation Pack client-ready được tổ chức lại dưới `docs/` với hai nhóm deliverable. Nhóm DOCX dành cho khách hàng và người chơi gồm `USER_GUIDE.docx`, `GAME_RULES.docx`, `ROLE_GUIDE.docx` và `BOT_SETUP.docx`. Nhóm Markdown dành cho technical team gồm `TECHNICAL_ARCHITECTURE.md`, `TECHNICAL_REFERENCE.md`, `DEVELOPMENT_GUIDE.md`, `BOT_OPERATIONS.md` và `CHANGELOG.md`.

### Content alignment

Nội dung được đối chiếu với `src/index.ts`, config, domain enums, room/player model, role registry, distribution strategy, state machine, night/day services, resolvers, Redis adapter, Telegram commands và tests. Các điểm không có source/test xác nhận được đánh dấu **CHƯA XÁC ĐỊNH**.

### Cleanup

Các tài liệu legacy trong thư mục `doc/` đã được loại bỏ khỏi working tree để tránh khách hàng hoặc developer sử dụng rule draft, dashboard guide cũ hoặc audit report không còn phù hợp. Bộ tài liệu chính thức mới nằm trong `docs/docx` và `docs/md`.

### Important scope note

Dashboard/login service không thuộc runtime hiện tại. HTTP surface hiện chỉ có `/health`; tài liệu không hướng dẫn port 3000, `/login`, `/dashboard`, `DASHBOARD_GATEWAY_SECRET`, `JWT_SECRET` hoặc SQL Database như một phần của bot chuẩn.

## [2026-08-25] — Runtime baseline recorded

### Game behavior

- Lifecycle được ghi nhận từ `WAITING` tới `GAME_OVER`, với early skip `DAY → VOTING` và discussion death path `DISCUSSION → CHECK_WIN`.
- Giới hạn player được ghi nhận là minimum 3 và maximum 15.
- Bảy role hiện được register, bao gồm `SILENT_MAGE`.
- Match 8–15 player tự động bao gồm Silent Mage cùng special roles mặc định theo strategy hiện tại.

### Persistence and concurrency

- Redis là operational store chính.
- Room save dùng Lua CAS và version check.
- Match events append vào `logs:{matchId}`.
- Action dedup, timer deadline và DM reachability dùng Redis marker riêng.

### Telegram and operations

- `/start`, `/create`, `/join`, `/leave`, `/startgame`, `/status`, `/vote`, `/end`, `/bottest` và `/help` là command surface hiện tại.
- Speech Silence Gate tách khỏi vote callback.
- Timer recovery và stale callback guards được ghi nhận trong operations guide.

## [2026-08-24] — Terminal mute cleanup baseline

### Bug fix recorded

Khi game kết thúc hoặc `/end` được gọi, terminal cleanup xóa stale mute fallback marker để marker cũ không tiếp tục ảnh hưởng room/session tiếp theo. Logic retry marker trong unmute bình thường vẫn được phân biệt với cleanup terminal.

### Operational implication

Bot không có Telegram API để “ẩn group”. Nếu user không nhìn thấy group, cần kiểm tra member status, client archive/mute, restriction, user đã rời group hay chưa, cùng với runtime mute marker trước khi quy kết lỗi cho bot.

## Change classification

| Category | Meaning trong changelog này |
|---|---|
| Added | Capability hoặc tài liệu mới đã được tạo. |
| Changed | Behavior/source contract đã thay đổi và cần review. |
| Fixed | Root cause đã được xác định và có regression coverage. |
| Recorded | Behavior hiện tại được audit/document, không nhất thiết là source change. |
| CHƯA XÁC ĐỊNH | Không đủ source/config/deployment evidence để kết luận. |

## References

[1]: ../../src/index.ts "Runtime and command surface"
[2]: ../../src/engine/role-distribution/RoleDistributionStrategy.ts "Role distribution"
[3]: ../../src/engine/state-machine/GameStateMachine.ts "State transitions"
[4]: ../../src/engine/ports/StoragePort.ts "Persistence contract"
[5]: ../../src/infrastructure/redis/RedisStorageAdapter.ts "Redis implementation"
[6]: ../../src/telegram/MuteService.ts "Terminal mute cleanup"

## Documentation governance

Mỗi lần cập nhật luật hoặc runtime cần nêu rõ phạm vi thay đổi, source of truth, ảnh hưởng đến player experience, ảnh hưởng đến persistence/timer và cách kiểm thử. Một tài liệu cũ chỉ được giữ lại khi nó vẫn phản ánh behavior đã build; nếu không, phải chuyển thành historical note hoặc loại khỏi thư mục bàn giao để tránh tạo hai phiên bản luật cùng tồn tại.

## Release-readiness interpretation

Mục `Recorded` trong changelog chỉ nói rằng một behavior đã được quan sát và ghi lại; nó không có nghĩa source vừa được sửa. Mục `Fixed` chỉ nên dùng khi có root cause và regression test. Mục `CHƯA XÁC ĐỊNH` yêu cầu product owner hoặc deployment owner đưa ra quyết định trước khi biến nó thành contract chính thức.

## Documentation-to-code map

| Deliverable | Mục tiêu | Nguồn code chính |
|---|---|---|
| `USER_GUIDE.docx` | Hướng dẫn player thao tác trong Telegram. | `src/telegram/commands`, `messages.ts`, `DayService.ts`, `NightActionService.ts` |
| `GAME_RULES.docx` | Baseline luật đang thực thi. | `enums.ts`, `GameStateMachine.ts`, `GameService.ts`, `DayService.ts`, `NightResolver.ts` |
| `ROLE_GUIDE.docx` | Mô tả role/action/target validation. | `src/engine/roles`, `RoleRegistry.ts`, `NightResolver.ts` |
| `BOT_SETUP.docx` | Cài đặt và runbook cơ bản. | `config.ts`, `index.ts`, `BotServices.ts`, `package.json` |
| Technical Markdown | Architecture, operations, development và reference. | Toàn bộ source/tests/config đã audit |

## Known non-goals

Documentation Pack này không phải API contract cho một dashboard web, không phải SQL schema, không phải SLA/SLO agreement, không phải security certification và không phải release note cho một version semantic cụ thể. Những nội dung đó chỉ được bổ sung khi có source hoặc quyết định triển khai được phê duyệt.

## Verification record

Bản refresh được kiểm tra bằng việc xác nhận đủ bốn DOCX và năm Markdown, kiểm tra cấu trúc heading/bảng, đọc được text tiếng Việt, kiểm tra ZIP/XML integrity của DOCX và đối chiếu trạng thái source để bảo đảm task tài liệu không sửa bot source. Các giới hạn còn lại được nêu trực tiếp trong từng tài liệu liên quan.
