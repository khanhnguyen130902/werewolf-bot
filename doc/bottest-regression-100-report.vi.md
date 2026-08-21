# Báo cáo Regression / Stress Test 100 vòng cho `bottest`

## Kết luận

Đã chạy **100 vòng liên tục** của full flow `/bottest` trong môi trường deterministic, sử dụng engine thật, `GameFlowController` thật, `BotPolicy` mới và `InMemoryStorageAdapter`. Tất cả 100 vòng đều đạt `GAME_OVER`, không có exception trong test, không có phase transition sai và output deterministic khớp baseline đã định nghĩa.

> **Kết quả:** 100/100 vòng pass; 100/100 vòng khớp baseline; 3.800 domain events và 600 telemetry observations được tạo; lint/build pass; edge-case suite pass.

## Phạm vi flow đã kiểm tra

Mỗi vòng bao phủ chuỗi chính:

`/bottest 6 seer` → tạo room → thêm 5 bot → persist `requestedRoleOverride` → `/startgame` → role assignment → First Night → night action → Seer/role resolution → Discussion → BotPolicy discussion/vote → execution → win condition → `GAME_OVER` → lưu event log và snapshot telemetry.

Các invariant bắt buộc trong mỗi vòng gồm: room có đúng 6 player; host nhận role `SEER`; room đi qua `DISCUSSION`; room kết thúc ở `GAME_OVER`; event log chứa `GAME_STARTED`, `ROLES_ASSIGNED`, `NIGHT_RESOLVED`, `EXECUTION_RESOLVED`, `WIN_CONDITION_MET` và `GAME_ENDED`; event count deterministic là 38; discussion count là 1; telemetry observation count là 6.

## Metrics tổng hợp

| Metric | Kết quả |
|---|---:|
| Tổng số vòng | 100 |
| Vòng pass | 100 |
| Vòng kết thúc `GAME_OVER` | 100 |
| Vòng khớp baseline deterministic | 100 |
| Tổng thời gian test logic | 776.97 ms |
| Thời gian trung bình/vòng | 7.77 ms |
| Thời gian nhanh nhất | 4.62 ms |
| Thời gian chậm nhất | 25.98 ms |
| CPU user tích lũy | 719 ms |
| CPU system tích lũy | 62 ms |
| Heap delta lớn nhất/vòng | 2,883,920 bytes |
| Heap delta nhỏ nhất/vòng | -61,344,024 bytes |
| RSS delta lớn nhất/vòng | 9,445,376 bytes |
| RSS delta nhỏ nhất/vòng | 0 bytes |
| Tổng domain events | 3,800 |
| Tổng telemetry observations | 600 |

Giá trị heap delta âm là hiện tượng bình thường khi garbage collector chạy giữa các vòng; vì vậy không được diễn giải là bộ nhớ bị “âm”. Chỉ số RSS delta lớn nhất khoảng 9.0 MiB trong harness process và không tăng đơn điệu theo số vòng. Đây là tín hiệu không phát hiện memory growth tuyến tính trong workload test này, nhưng chưa thay thế cho profiling process production chạy lâu với Telegram/Redis thật.

## Regression và edge-case

| Nhóm kiểm tra | Kết quả |
|---|---:|
| `BotPolicy` unit tests | Pass: 4 tests |
| `/bottest` command regression | Pass |
| E2E bottest single-flow | Pass |
| Main functional suite, loại riêng stress harness | Pass: 28 suites / 247 tests |
| Edge-case role/state/night/day/callback/vote suite | Pass: 8 suites / 101 tests |
| Stress harness 100 vòng | Pass: 1 suite / 1 test, bên trong 100 scenarios |
| `npm run lint` | Pass |
| `npm run build` | Pass |
| `git diff --check` | Pass |

Full suite có stress harness 100 vòng được chạy tách riêng để tránh một test dài làm che khuất kết quả các suite chức năng chính. Cách tách này không bỏ coverage: 28 suite chính được chạy độc lập, sau đó stress harness chạy đủ 100 scenario và exact baseline assertions.

## Baseline deterministic

Baseline dùng cùng cấu hình 6 player, role override `SEER`, deterministic engine random, `Math.random = 0.99`, timer fake và scheduler in-memory. Baseline contract được kiểm tra exact ở cả 100 vòng:

| Baseline invariant | Giá trị yêu cầu | Kết quả |
|---|---:|---:|
| Final state | `GAME_OVER` | 100/100 |
| Discussion rounds | 1 | 100/100 |
| Domain event count | 38 | 100/100 |
| Telemetry observations | 6 | 100/100 |
| Required event types | 6 loại chính | 100/100 |

Việc so sánh exact chỉ áp dụng cho deterministic profile. Ở production, personality, timing và random policy được thiết kế để tạo hành vi đa dạng; do đó không nên yêu cầu từng message hoặc từng target ngẫu nhiên phải giống 100% giữa các run khác seed. Với profile stochastic, tiêu chí đúng là invariant, không crash, không deadlock, hợp lệ role/phase và phân phối hành vi nằm trong ngưỡng cân bằng đã chọn.

## Artifact

- Test harness: `tests/telegram/BottestStress100.e2e.test.ts`
- Metrics raw: `bottest-stress-100-results.json`
- Policy unit test: `tests/telegram/BotPolicy.test.ts`
- E2E flow test: `tests/telegram/BottestFlow.e2e.test.ts`

## Giới hạn và khuyến nghị tiếp theo

Stress test hiện là in-process test với in-memory storage và fake scheduler, nên đo tốt logic, event, telemetry, phase transition, CPU và memory của harness nhưng chưa đo latency Telegram API, Redis round-trip, BullMQ queue delay hoặc network retry. Muốn đánh giá production performance cần chạy thêm profile dài với Redis/BullMQ thật, nhiều room đồng thời, nhiều message callback đồng thời và process uptime kéo dài.

Không thực hiện vote revision trong đợt này; engine vẫn giữ contract một vote cuối mỗi player. Discussion mới ghi nhận claim, accusation, defense và vote observation trong phạm vi bot policy mà không thay đổi state machine hoặc `DayService` contract.
