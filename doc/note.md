# Werewolf Bot — Note chạy server và test

Tài liệu này là cheat sheet dành cho Windows CMD/PowerShell khi phát triển, kiểm thử và vận hành Werewolf Bot.

> **Thư mục dự án local:** `C:\Users\quock\OneDrive\Desktop\werewolf-bot`

## 1. Mở terminal và vào project

### CMD

```cmd
cd /d C:\Users\quock\OneDrive\Desktop\werewolf-bot
```

### PowerShell

```powershell
Set-Location "C:\Users\quock\OneDrive\Desktop\werewolf-bot"
```

Kiểm tra đang đứng đúng thư mục:

```cmd
cd
where node
node --version
npm --version
```

## 2. Cài dependency

Cài mới hoặc cài lại dependency theo lockfile:

```cmd
npm install
```

Khi muốn cài đúng phiên bản lockfile trong CI/production:

```cmd
npm ci
```

Kiểm tra package tree:

```cmd
npm list --depth=0
```

## 3. Cấu hình `.env`

Tạo hoặc mở file `.env` ở thư mục gốc project. Không commit file này và không gửi Telegram token/password trong log.

```dotenv
TELEGRAM_BOT_TOKEN=<TELEGRAM_BOT_TOKEN>
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
NODE_ENV=development
PORT=3000
MUTE_DEAD_PLAYERS=true
```

Kiểm tra file tồn tại mà không in secret:

### CMD

```cmd
if exist .env (echo ENV_PRESENT) else (echo ENV_MISSING)
```

### PowerShell

```powershell
if (Test-Path .env) { "ENV_PRESENT" } else { "ENV_MISSING" }
```

Sau khi sửa `.env`, phải restart process. Process đang chạy không tự nhận giá trị environment mới.

## 4. Kiểm tra Redis

Werewolf Bot dùng Redis cho room state, idempotency và BullMQ scheduler. Redis local mặc định chạy tại `127.0.0.1:6379`.

### Kiểm tra Redis đã listen

```cmd
netstat -ano | findstr :6379
```

### Kiểm tra Redis bằng redis-cli

```cmd
redis-cli.exe -h 127.0.0.1 -p 6379 ping
redis-cli.exe -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy
```

Kết quả cần có:

```text
PONG
maxmemory-policy
noeviction
```

Nếu máy không nhận `redis-cli`:

```cmd
where redis-cli
```

Nếu không tìm thấy, kiểm tra Redis bằng provider/dashboard hoặc dùng test scheduler trong project.

### Kiểm tra port bằng PowerShell

```powershell
Test-NetConnection 127.0.0.1 -Port 6379
Get-NetTCPConnection -LocalPort 6379 -State Listen
```

### Lỗi thường gặp Redis

Nếu thấy `ECONNREFUSED 127.0.0.1:6379`, Redis chưa chạy, sai port hoặc `REDIS_URL` chưa được process đọc lại. Nếu thấy `volatile-lru`, cần đổi policy thành `noeviction` trước khi dùng BullMQ trong production.

## 5. Kiểm tra code trước khi chạy

### Lint

```cmd
npm run lint
```

### TypeScript compile/build

Build production artifact:

```cmd
npm run build
```

Chỉ kiểm tra type mà không ghi artifact:

```cmd
npx tsc --noEmit -p tsconfig.json
```

### Kiểm tra thay đổi Git

```cmd
git status --short
git diff --check
git log -5 --oneline
```

## 6. Chạy server

### Development server

```cmd
npm run dev
```

Script tương ứng là `ts-node-dev --respawn --transpile-only src/index.ts`.

Giữ terminal này mở để xem log realtime. Mở terminal thứ hai để chạy health/test command.

### Production-like server

Build trước:

```cmd
npm run build
```

Sau đó chạy:

```cmd
npm start
```

Hoặc chạy trực tiếp:

```cmd
node dist/index.js
```

### Chạy với log chi tiết

CMD:

```cmd
set LOG_LEVEL=silly&& npm run dev
```

PowerShell:

```powershell
$env:LOG_LEVEL="silly"
npm run dev
```

Sau khi debug xong, đưa về mức bình thường:

```powershell
$env:LOG_LEVEL="info"
```

`LOG_LEVEL=silly` chỉ nên bật trong thời gian điều tra vì log rất nhiều. Không gửi token, password hoặc toàn bộ `.env` khi chia sẻ log.

## 7. Health check và kiểm tra process

### Health endpoint

CMD:

```cmd
curl.exe -i http://127.0.0.1:3000/health
```

PowerShell:

```powershell
Invoke-WebRequest http://127.0.0.1:3000/health | Select-Object StatusCode,Content
```

Kết quả đúng:

```json
{"status":"ok"}
```

### Kiểm tra port 3000

```cmd
netstat -ano | findstr :3000
```

Lấy PID từ kết quả rồi xem process:

```cmd
tasklist /FI "PID eq <PID>"
```

PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000
Get-Process node
```

### Dừng server

CMD:

```cmd
taskkill /PID <PID> /T /F
```

PowerShell:

```powershell
Stop-Process -Id <PID>
```

Ưu tiên dừng graceful bằng `Ctrl+C` trong terminal đang chạy `npm run dev`. Chỉ dùng kill cưỡng bức khi process bị treo.

## 8. Chạy test nhanh

### Chạy toàn bộ suite

```cmd
npm test -- --runInBand
```

Hoặc:

```cmd
npm test
```

Kết quả thành công gần đây của project là **25 test suites / 240 tests pass** khi Redis local hoạt động đúng.

### Chạy một file test

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts
```

### Chạy test mới cho toàn bộ role

```cmd
npm test -- --runInBand tests/engine/AllRolesAcceptance.test.ts
```

Test script này bao phủ Werewolf, Villager, Seer, Witch, Bodyguard và Hunter, gồm metadata, happy path, invalid target, self-target, Skip, potion state, self-protect và các rule validation.

### Chạy nhóm test role và night action

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts tests/engine/NightActionService.test.ts tests/engine/NightResolver.test.ts tests/engine/DeathQueue.test.ts tests/engine/WinConditionChecker.test.ts
```

### Chạy test main flow

```cmd
npm test -- --runInBand tests/engine/EndToEnd.test.ts tests/engine/GameOrchestrator.test.ts tests/engine/GameService.test.ts tests/telegram
```

### Chạy test lobby/room/state

```cmd
npm test -- --runInBand tests/engine/RoomService.test.ts tests/engine/GameStateMachine.test.ts tests/engine/RoomTimerService.test.ts
```

### Chạy test scheduler/Redis

```cmd
npm test -- --runInBand tests/infrastructure/BullMqSchedulerPort.test.ts
```

Suite này kiểm tra Redis reachable, job fire sau delay, cancel job và restart resilience.

### Phát hiện open handle/timer leak

```cmd
npx jest tests/engine tests/telegram --runInBand --detectOpenHandles --forceExit
```

### Chạy coverage

```cmd
npx jest tests/engine tests/telegram --runInBand --coverage --forceExit
```

Coverage output nằm trong thư mục `coverage`.

## 9. Kịch bản test role chi tiết

### Werewolf

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Werewolf"
npm test -- --runInBand tests/engine/NightActionService.test.ts -t "werewolf"
```

Cần kiểm tra target sống, Skip, consensus, đổi target, duplicate action, timeout và win condition parity.

### Villager

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Villager"
```

Cần xác nhận Villager không có night ability và validation defensive không làm crash engine.

### Seer

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Seer"
npm test -- --runInBand tests/engine/NightActionService.test.ts -t "Seer"
```

Cần kiểm tra inspect target sống, reject self/dead target, consecutive target rule và việc kết quả soi vẫn được xử lý đúng.

### Witch

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Witch"
npm test -- --runInBand tests/engine/NightActionService.test.ts -t "Witch"
```

Cần kiểm tra save, poison, Skip, potion đã dùng, self-save, self-poison, target chết và dual-potion setting.

### Bodyguard

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Bodyguard"
npm test -- --runInBand tests/engine/NightActionService.test.ts -t "Bodyguard"
```

Cần kiểm tra protect target sống, self-protect theo setting, target chết và không protect cùng target trong hai đêm liên tiếp.

### Hunter

```cmd
npm test -- --runInBand tests/engine/Roles.test.ts -t "Hunter"
npm test -- --runInBand tests/engine/NightActionService.test.ts -t "Hunter"
```

Cần kiểm tra death queue, target sống, reject self-target, Skip, timeout và việc Hunter shot được áp dụng đúng sau khi Hunter chết.

## 10. Smoke test Telegram bằng người thật

Sau khi server chạy, thực hiện theo thứ tự:

```text
1. Gửi /help để xác nhận bot phản hồi.
2. Gửi /create để tạo room.
3. Các player gửi /join.
4. Host gửi /status để kiểm tra lobby.
5. Host gửi /startgame.
6. Player đọc role trong private chat.
7. Thực hiện một night action hoặc Skip.
8. Kiểm tra bot chuyển phase.
9. Thảo luận và vote bằng /vote hoặc callback button.
10. Kiểm tra execution, Hunter trigger nếu có và win condition.
```

Không dùng room production để test callback hoặc role override. Tạo group/room test riêng.

## 11. Chẩn đoán lỗi nhanh

| Triệu chứng | Lệnh đầu tiên | Hướng xử lý |
|---|---|---|
| Bot không khởi động | `npm run dev` | Đọc dòng lỗi đầu tiên; kiểm tra `.env`, token và Redis. |
| Health connection refused | `curl.exe -i http://127.0.0.1:3000/health` | Kiểm tra process/port 3000. |
| Redis connection refused | `redis-cli.exe ... ping` | Khởi động Redis hoặc sửa `REDIS_URL`, sau đó restart bot. |
| BullMQ test fail | `npm test -- --runInBand tests/infrastructure/BullMqSchedulerPort.test.ts` | Kiểm tra Redis và policy `noeviction`. |
| Action bị duplicate | Test log với `LOG_LEVEL=silly` | Không submit lại cùng action ID; kiểm tra latest action/round. |
| Game đứng ở phase | `/status`, log timer/queue | Kiểm tra Redis, BullMQ và room deadline; không xóa Redis tùy tiện. |
| Lint fail | `npm run lint` | Sửa lỗi file/line được báo, chạy lại lint. |
| TypeScript fail | `npx tsc --noEmit -p tsconfig.json` | Sửa type error trước khi build/deploy. |

## 12. Quy trình test đầy đủ trước deploy

Chạy tuần tự:

```cmd
cd /d C:\Users\quock\OneDrive\Desktop\werewolf-bot
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm test -- --runInBand tests/engine/AllRolesAcceptance.test.ts
curl.exe -i http://127.0.0.1:3000/health
```

Nếu có Redis local, kiểm tra thêm:

```cmd
redis-cli.exe -h 127.0.0.1 -p 6379 ping
redis-cli.exe -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy
npm test -- --runInBand tests/infrastructure/BullMqSchedulerPort.test.ts
```

Không deploy khi còn một trong các điều kiện sau:

- `npm run lint` fail.
- `npm run build` fail.
- Full Jest suite fail.
- Redis không reachable.
- Redis policy không phải `noeviction`.
- `/health` không trả HTTP 200.
- Telegram smoke test không phản hồi.

## 13. Lưu log khi gửi bug

PowerShell có thể redirect log của server vào file:

```powershell
$env:LOG_LEVEL="silly"
npm run dev 2>&1 | Tee-Object -FilePath .\dev-debug.log
```

Sau khi tái hiện lỗi, dừng server bằng `Ctrl+C` và lọc nhanh:

```powershell
Select-String -Path .\dev-debug.log -Pattern "error|warn|failed|timeout|duplicate|Redis|BullMQ" -CaseSensitive:$false
```

Không gửi `.env` hoặc token kèm log. Chỉ gửi đoạn log liên quan, timestamp, room ID, action type và bước tái hiện.

## 14. Lệnh Git hữu ích

```cmd
git status --short
git diff --check
git diff
git log -5 --oneline
git branch --show-current
```

Kiểm tra test file mới có trong working tree:

```cmd
if exist tests\engine\AllRolesAcceptance.test.ts (echo ROLE_SCRIPT_PRESENT) else (echo ROLE_SCRIPT_MISSING)
```

## 15. Lệnh một dòng cho quy trình nhanh

### Verify toàn bộ trước deploy

```cmd
npm run lint && npm run build && npm test -- --runInBand
```

### Verify role test và health

```cmd
npm test -- --runInBand tests/engine/AllRolesAcceptance.test.ts && curl.exe -sS http://127.0.0.1:3000/health
```

### Verify Redis + scheduler

```cmd
redis-cli.exe -h 127.0.0.1 -p 6379 ping && redis-cli.exe -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy && npm test -- --runInBand tests/infrastructure/BullMqSchedulerPort.test.ts
```

> **Nguyên tắc:** luôn xem log và kết quả test sau mỗi command; không chạy nối tiếp bằng `&&` nếu bạn cần giữ lại lỗi chi tiết của từng bước.
