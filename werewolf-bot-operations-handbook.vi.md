# Werewolf Bot — Sổ tay vận hành và xử lý sự cố

**Phiên bản tài liệu:** 1.0  
**Phạm vi:** Telegram Werewolf Bot, engine game, Redis, BullMQ scheduler và quy trình vận hành trên môi trường development/staging/production.  
**Cập nhật theo codebase:** `werewolf-bot` hiện tại.

> **Mục tiêu vận hành:** bảo đảm bot khởi động ổn định, timer và state game được lưu bền vững, lỗi được phát hiện nhanh, thao tác khôi phục không làm mất ván đang chạy và log có đủ thông tin để truy vết mà không làm lộ secret.

## 1. Tổng quan hệ thống

Hệ thống gồm Telegram bot, game engine, Redis storage và BullMQ scheduler. Telegram nhận command hoặc callback, `GameFlowController` chuyển input thành thao tác domain, các service engine cập nhật `RoomState`, phát domain event và tạo/cancel timer. Redis lưu room state, action idempotency và dữ liệu scheduler; BullMQ dùng Redis để giữ các job timeout và hỗ trợ resume sau restart.

Luồng xử lý chuẩn là:

```text
Telegram update
  → command/callback handler
  → GameFlowController
  → GameOrchestrator / domain service
  → RoomState + EventBus
  → Redis Storage / BullMQ Scheduler
  → Telegram response
```

Các phase game chính là `WAITING → STARTING → FIRST_NIGHT → NIGHT → DAY → DISCUSSION → VOTING → EXECUTION → CHECK_WIN`, sau đó lặp lại `NIGHT` hoặc chuyển sang `GAME_OVER`. Các role hiện có là **Werewolf, Villager, Seer, Witch, Bodyguard và Hunter**.

## 2. Thành phần cần giám sát

| Thành phần | Vai trò | Dấu hiệu hoạt động bình thường | Rủi ro chính |
|---|---|---|---|
| Telegram bot | Nhận command/callback và gửi prompt | Có log bot startup và không có lỗi polling/API liên tục | Token sai, bot bị Telegram từ chối, callback không tới |
| HTTP health server | Endpoint kiểm tra process | `GET /health` trả HTTP `200` và `{"status":"ok"}` | Process sống nhưng game service hoặc Redis lỗi |
| Redis | Lưu room, idempotency và BullMQ data | TCP `6379` reachable, `PING` thành công | Mất kết nối, eviction key, ACL chặn command |
| BullMQ | Timer night/day/vote và resume job | Scheduler test fire/cancel/restart pass | Job không fire, duplicate job, queue backlog |
| Game engine | Luật role, phase, vote và win condition | State transition hợp lệ, event phát đầy đủ | State inconsistency, stale action, race condition |

## 3. Cấu hình môi trường

Các biến môi trường được đọc một lần khi process khởi động trong `src/config/config.ts`. Thay đổi `.env` **không áp dụng vào process đang chạy**; phải restart process.

| Biến | Bắt buộc | Giá trị/ý nghĩa |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | Có | Token bot Telegram. Không ghi token vào log hoặc gửi trong trace. |
| `REDIS_URL` | Không | Mặc định `redis://localhost:6379`; production nên dùng URL Redis riêng, có TLS nếu provider yêu cầu. |
| `LOG_LEVEL` | Không | Mặc định `info`; dùng `debug` hoặc `silly` khi điều tra lỗi ngắn hạn. |
| `NODE_ENV` | Không | Mặc định `development`; production dùng `production` để chọn format log JSON hiện tại. |
| `PORT` | Không | Mặc định `3000`; dùng cho HTTP health server. |
| `MUTE_DEAD_PLAYERS` | Không | Mặc định bật; đặt `false` nếu không muốn bot tự mute player đã chết. |

Ví dụ cấu hình local an toàn:

```dotenv
TELEGRAM_BOT_TOKEN=<không-ghi-token-vào-tài-liệu>
REDIS_URL=redis://localhost:6379
LOG_LEVEL=debug
NODE_ENV=development
PORT=3000
MUTE_DEAD_PLAYERS=true
```

Redis phải dùng `maxmemory-policy=noeviction` cho workload BullMQ. Có thể kiểm tra policy bằng Redis CLI:

```bash
redis-cli -h 127.0.0.1 -p 6379 PING
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy
```

Kết quả hợp lệ là `PONG` và policy `noeviction`. Nếu Redis provider chặn `CONFIG GET` hoặc `CONFIG SET`, phải kiểm tra policy trong dashboard/provider thay vì cố sửa từ application.

## 4. Khởi động, dừng và kiểm tra cơ bản

### 4.1. Development

```bash
npm install
npm run dev
```

`npm run dev` chạy `ts-node-dev --respawn --transpile-only src/index.ts`. Khi cần đổi `.env`, hãy dừng rồi chạy lại tiến trình; không chỉ chờ hot reload vì config được nạp lúc startup.

### 4.2. Production-like

```bash
npm ci
npm run lint
npm run build
npm test -- --runInBand
NODE_ENV=production LOG_LEVEL=info npm start
```

`npm run build` biên dịch theo `tsconfig.json`, sau đó `npm start` chạy `dist/index.js`. Không deploy nếu build, lint hoặc full test fail.

### 4.3. Health check

```bash
curl -i http://127.0.0.1:3000/health
```

Kết quả mong đợi:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

Health `200` chỉ chứng minh HTTP process đang sống. Nó **không tự chứng minh** Telegram polling, Redis hoặc BullMQ đang khỏe; cần kiểm tra thêm startup log và Redis connectivity.

### 4.4. Dừng an toàn

Process xử lý `SIGINT` và `SIGTERM`, đóng HTTP server, dừng bot và gọi `services.shutdown()` để đóng scheduler/worker/queue. Ưu tiên gửi `SIGTERM` và chờ graceful shutdown thay vì kill cưỡng bức.

```bash
# Linux/macOS
kill -TERM <PID>

# Windows PowerShell
Stop-Process -Id <PID>
```

Sau khi restart, kiểm tra log resume room overdue. Không xóa Redis key, queue hoặc room state trong lúc điều tra nếu chưa có quyết định khôi phục rõ ràng.

## 5. Logging và thu thập trace

Logger hiện dùng Winston và ghi ra console. `LOG_LEVEL` quyết định mức log; các mức thường dùng là `error`, `warn`, `info`, `debug` và `silly`. Trong điều tra ngắn hạn, dùng:

```dotenv
LOG_LEVEL=silly
```

Sau khi thu thập đủ trace, đưa về `info` hoặc `warn` để tránh quá nhiều log và tránh tăng chi phí lưu trữ.

Khi gửi log cho developer, cần lấy một khoảng thời gian có cả thao tác trước lỗi, dòng lỗi và thao tác ngay sau lỗi. Không gửi `TELEGRAM_BOT_TOKEN`, password, Redis URL có password, cookie hoặc toàn bộ `.env`.

Mẫu thông tin cần gửi:

```text
Thời điểm và timezone:
Chat/room bị ảnh hưởng:
Telegram user hoặc test bot:
Command/callback vừa thực hiện:
Kết quả mong đợi:
Kết quả thực tế:
Lỗi hiển thị cho user:
Khoảng log liên quan:
Commit/version đang chạy:
Đã retry hay restart chưa:
```

Khi hệ thống có `traceId` trong log, hãy gửi tất cả dòng cùng `traceId`. Nếu chưa có traceId trong một nhánh cũ, dùng timestamp gần nhất kết hợp `roomId`, `chatId` và action type để lọc.

## 6. Quy trình xử lý sự cố chuẩn

Khi có incident, trước hết hãy xác định phạm vi: một user, một room, toàn bộ bot, hay chỉ scheduler. Sau đó bảo toàn bằng chứng trước khi restart hoặc xóa dữ liệu.

| Bước | Việc cần làm | Kết quả cần lưu |
|---:|---|---|
| 1 | Ghi timestamp, room/chat, user, command/action và version | Incident context |
| 2 | Lấy log trước/sau lỗi | Log excerpt hoặc traceId |
| 3 | Kiểm tra process và `/health` | PID, port, HTTP status |
| 4 | Kiểm tra Redis PING, policy và connection error | Redis evidence |
| 5 | Kiểm tra state room và timer liên quan | Game state, round, phase |
| 6 | Xác định có cần restart không | Quyết định và lý do |
| 7 | Reproduce bằng test hoặc room test riêng | Bước tái hiện |
| 8 | Fix, chạy focused test rồi full regression | Test result |
| 9 | Theo dõi sau fix | Không tái diễn trong khoảng quan sát |

Không nên restart nhiều lần liên tiếp khi chưa lưu log; restart có thể làm mất ngữ cảnh lỗi và làm thay đổi timer/resume behavior.

## 7. Ma trận troubleshooting

### 7.1. Bot không khởi động

**Triệu chứng:** process thoát ngay, log có `Missing required environment variable` hoặc `Fatal error during bot startup`.

**Kiểm tra:** xác nhận `TELEGRAM_BOT_TOKEN` tồn tại, `REDIS_URL` parse được, port không bị chiếm và Node dependency đã cài.

```bash
npm install
npm run build
```

Không in trực tiếp giá trị token để kiểm tra. Chỉ kiểm tra biến có tồn tại và đúng secret store.

### 7.2. Health trả lỗi hoặc port 3000 không listen

**Triệu chứng:** `curl /health` connection refused hoặc process thoát.

**Xử lý:** xem startup log, kiểm tra `PORT`, kiểm tra process khác đang dùng port, sau đó restart một lần. Nếu build pass nhưng startup fail, giữ nguyên stack trace và kiểm tra dependency initialization trong `BotServices.initialize()`.

### 7.3. Redis connection refused

**Triệu chứng:** `ECONNREFUSED 127.0.0.1:6379`, BullMQ queue/worker error hoặc room không đọc được.

**Xử lý:**

```bash
redis-cli -h 127.0.0.1 -p 6379 PING
```

Nếu local Redis chưa chạy, khởi động Redis theo cách quản trị của môi trường. Nếu dùng provider, kiểm tra host/port/TLS/password trong secret store và không đổi sang localhost ngoài môi trường local. Sau khi sửa `REDIS_URL`, phải restart bot.

### 7.4. Redis policy không phải `noeviction`

**Triệu chứng:** log cảnh báo Redis eviction policy hoặc application báo BullMQ durability không được bảo đảm.

**Nguyên nhân:** Redis đang dùng policy như `volatile-lru`; key/job có thể bị eviction khi bộ nhớ đầy.

**Xử lý:** đổi policy trong Redis provider/dashboard về `noeviction`, xác nhận lại bằng `CONFIG GET maxmemory-policy` nếu command được phép, rồi restart bot. Không coi việc test scheduler pass là đủ nếu production Redis vẫn có policy eviction không phù hợp.

### 7.5. BullMQ job không fire hoặc timer bị trễ

**Triệu chứng:** night/vote/discussion không chuyển phase, queue error, job restart test fail hoặc room bị kẹt ở phase có timer.

**Kiểm tra:** Redis reachable, policy `noeviction`, process log có queue/worker error, room còn deadline nào trong Redis và job có còn ở trạng thái delayed/waiting không.

**Khôi phục:** không tự tạo thêm nhiều job thủ công. Restart graceful để worker reconnect và startup resume các room overdue. Sau restart, kiểm tra log `Resuming overdue room ...`; nếu room vẫn kẹt, lưu room state và xử lý theo runbook game-state bên dưới.

### 7.6. Duplicate action hoặc nút callback bị bấm hai lần

**Triệu chứng:** user thấy action đã thực hiện, log có duplicate action hoặc callback trả lỗi dù trạng thái đã cập nhật.

**Diễn giải:** night action dùng idempotency/action ID. Retry cùng action có thể bị từ chối có chủ đích để tránh double kill, double potion hoặc double vote.

**Xử lý:** phân biệt duplicate hợp lệ với lỗi retry. Không reset state để ép submit lại. Lấy `roomId`, actor, action type, round và action ID; kiểm tra latest submission của actor trong round.

### 7.7. Werewolf không đồng thuận hoặc bị timeout

**Kiểm tra:** tất cả Werewolf còn sống đã gửi latest target hay skip chưa; một skip là lựa chọn hợp lệ; action cũ không được tính thay action mới.

Nếu không đồng thuận, bot có thể gửi thông báo và chờ theo timeout policy. Không sửa trực tiếp room state trong Redis khi chưa xác định phase và round, vì có thể tạo stale action.

### 7.8. Witch save/poison không hoạt động

**Kiểm tra:** Witch còn sống, đúng phase, potion tương ứng chưa dùng, target còn sống và setting có cho phép dùng dual potion trong cùng đêm hay không. Potion inventory là match-scoped; restart process không được làm potion quay lại trạng thái chưa dùng.

### 7.9. Bodyguard không bảo vệ được mục tiêu

**Kiểm tra:** target còn sống, setting `bodyguardAllowSelfProtect`, và target có trùng target của đêm trước hay không. Rule không bảo vệ cùng một target trong hai đêm liên tiếp phải được giữ nguyên.

### 7.10. Hunter không hiện prompt khi chết

**Kiểm tra:** Hunter có nằm trong death queue không, callback revenge có được gửi không, target có còn sống và không phải chính Hunter không, timeout callback có hoàn tất promise không. Hunter là death-triggered action, không phải regular night action; không ép xử lý bằng regular night phase.

### 7.11. Room bị kẹt sau restart

**Triệu chứng:** process đã lên nhưng room không tiếp tục.

**Xử lý:** kiểm tra startup log resume overdue room, state `gameState`, `nightPhase`, `currentRound`, deadline và pending actions. Không xóa room hoặc queue trước khi snapshot dữ liệu. Nếu room state hợp lệ nhưng timer mất, restart graceful một lần để resume; nếu vẫn lỗi, tái hiện trên room test và lưu state tối thiểu để tạo regression test.

## 8. Quy tắc xử lý dữ liệu game

Room state là dữ liệu sống của ván. Không chỉnh trực tiếp Redis bằng tay trong production trừ khi có incident commander phê duyệt và đã lưu backup/snapshot. Các trường cần bảo toàn gồm `gameState`, `nightPhase`, `currentRound`, players/alive/death cause, pending night actions, Witch potion state, vote state và timer deadline.

Khi cần cô lập một ván lỗi, ưu tiên tạo room test mới để tái hiện. Chỉ kết thúc room production bằng command nghiệp vụ phù hợp; không kill process để “reset” game vì scheduler và persistence được thiết kế để resume.

## 9. Checklist trước deploy

### Build và code quality

- `npm ci` hoàn tất không lỗi.
- `npm run lint` pass.
- `npm run build` pass.
- `npm test -- --runInBand` pass toàn bộ.
- Không còn thay đổi ngoài dự kiến trong `git status`.
- Không có secret trong source, log hoặc artifact deploy.

### Redis và scheduler

- `REDIS_URL` trỏ đúng môi trường, không dùng localhost trong production.
- Redis `PING` pass từ host chạy bot.
- `maxmemory-policy=noeviction` đã được xác nhận.
- BullMQ scheduler test fire/cancel/restart pass trong môi trường tương đương production.
- Có kế hoạch reconnect, alert queue error và xử lý Redis outage.

### Runtime và game

- `/health` trả `200`.
- Startup log xác nhận bot, HTTP server, Redis policy và scheduler đều hoạt động.
- Smoke test Telegram: create room, join, start game, một night action, vote và end/reach game-over.
- Kiểm tra một timeout và một retry/duplicate callback.
- Có người chịu trách nhiệm theo dõi log sau deploy.

## 10. Checklist sau deploy

Trong 15 phút đầu, kiểm tra không có `Fatal error`, `ECONNREFUSED`, BullMQ queue/worker error, Telegram API error bất thường hoặc phase transition thất bại. Tạo một room smoke test, xác nhận prompt đến đúng private/group chat và xác nhận timer chuyển phase. Sau đó kiểm tra Redis memory, queue backlog và số room active.

Trong 24 giờ đầu, theo dõi tần suất lỗi theo `roomId`, role/action type, timeout và retry. Nếu xuất hiện lỗi mới, bảo toàn log trước khi restart và mở incident record theo mẫu ở phần dưới.

## 11. Mẫu incident report

```markdown
# Incident: <tiêu đề ngắn>

- Thời điểm bắt đầu:
- Thời điểm kết thúc:
- Môi trường/version/commit:
- Mức độ: P0 / P1 / P2 / P3
- Room/chat bị ảnh hưởng:
- User/test bot bị ảnh hưởng:

## Triệu chứng

## Kết quả mong đợi

## Kết quả thực tế

## Bước tái hiện

1.
2.
3.

## Log/trace đã redact

```text
<chỉ gửi đoạn log liên quan, không gửi token/password/cookie>
```

## Phạm vi ảnh hưởng

## Mitigation đã thực hiện

## Root cause

## Fix và test xác nhận

## Follow-up
```

## 12. Các lệnh kiểm tra nhanh

```bash
# Code quality
npm run lint
npm run build
npm test -- --runInBand

# Runtime
curl -i http://127.0.0.1:3000/health

# Redis local
redis-cli -h 127.0.0.1 -p 6379 PING
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy

# Process/port trên Linux
ps aux | grep -E 'node|werewolf'
ss -ltnp | grep 3000

# Process/port trên Windows PowerShell
Get-Process node
Get-NetTCPConnection -LocalPort 3000
Get-NetTCPConnection -LocalPort 6379
```

> **Nguyên tắc cuối:** không kết luận “đã fix” chỉ vì process khởi động lại thành công. Một sự cố chỉ được đóng khi đã xác định nguyên nhân, có bước tái hiện hoặc bằng chứng phù hợp, có test/verification sau fix và đã theo dõi đủ lâu để bảo đảm không tái diễn.
