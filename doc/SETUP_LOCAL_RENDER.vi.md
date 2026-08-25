# Werewolf Bot & Dashboard — Hướng dẫn setup Local và Render

Tài liệu này cấu hình **hai service độc lập**: `werewolf-bot` quản lý Telegram, Redis và gateway chỉ-đọc; `werewolf-dashboard` cung cấp giao diện quản trị username/password. Khi chạy local, toàn bộ giá trị cấu hình nằm trong **một file `.env` vật lý duy nhất** đặt tại `werewolf-bot/.env`; dashboard sử dụng hard link Windows tới chính file đó. Vì vậy không có hai bản `.env` dễ bị lệch giá trị.

> Không commit `.env`, không gửi secret qua chat, và không dùng Redis port `6379` làm URL dashboard. Dashboard chỉ gọi HTTP gateway của bot.

## 1. Kiến trúc và biến dùng chung

```text
Telegram ──> Werewolf Bot ──> Redis
                  ▲
                  │ HTTP gateway + DASHBOARD_GATEWAY_SECRET
                  │
           Werewolf Dashboard ──> MySQL/TiDB (users only)
```

Tạo hai secret khác nhau. Chạy từng lệnh trong PowerShell tại máy local:

```powershell
# Secret dùng chung giữa bot và dashboard
$GatewaySecret = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Secret JWT chỉ dùng dashboard
$JwtSecret = node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

$GatewaySecret
$JwtSecret
```

Giữ lại hai giá trị. `GatewaySecret` và `JwtSecret` đều sẽ được ghi một lần trong file `.env` chung; bot chỉ đọc gateway secret, còn dashboard chỉ sử dụng JWT secret.

## 2. Local: một file `.env` nguồn duy nhất

Trong thư mục `werewolf-bot`, copy `.env.example` thành `.env`, rồi điền **toàn bộ** cấu hình bot và dashboard theo mẫu dưới đây. Dùng token Telegram dev riêng nếu có thể. Không tạo một file `.env` thứ hai với các giá trị sao chép thủ công.

```env
# Cấu hình chung local
NODE_ENV=development

# Bot và Redis
TELEGRAM_BOT_TOKEN=<token-tu-BotFather>
REDIS_URL=redis://127.0.0.1:6379
LOG_LEVEL=debug
MUTE_DEAD_PLAYERS=true
BOT_PORT=3001

# Gateway chỉ-đọc: bot và dashboard cùng dùng đúng một giá trị.
DASHBOARD_GATEWAY_SECRET=<GatewaySecret>

# Dashboard HTTP. Truy cập dashboard qua http://localhost:3000/dashboard
DASHBOARD_PORT=3000

# Dashboard database dành riêng cho user/password, không dùng Redis.
DATABASE_URL=mysql://<username>:<password>@127.0.0.1:3306/<dashboard_database>
JWT_SECRET=<JwtSecret>

# Dashboard chỉ gọi HTTP gateway bot, không bao giờ gọi Redis 6379.
WEREWOLF_BOT_DASHBOARD_URL=http://127.0.0.1:3001

# Chỉ bootstrap tài khoản admin đầu tiên nếu database chưa có local admin.
DASHBOARD_ADMIN_USERNAME=admin_werewolf
DASHBOARD_ADMIN_PASSWORD=<password-rieng-toi-thieu-12-ky-tu>
```

Tạo hard link cho dashboard. Lệnh này tạo thêm một đường dẫn `werewolf-dashboard/.env`, nhưng **không tạo file dữ liệu thứ hai**: cả hai đường dẫn cùng trỏ tới một nội dung duy nhất. Nếu dashboard đã có `.env` cũ, sao lưu rồi xóa nó trước khi chạy lệnh.

```powershell
$BotEnv = 'C:\Users\quock\OneDrive\Desktop\werewolf-bot\.env'
$DashboardEnv = 'C:\Users\quock\OneDrive\Desktop\werewolf-dashboard\.env'

New-Item -ItemType HardLink -Path $DashboardEnv -Target $BotEnv
```

> Nếu dashboard source đang ở thư mục khác, chỉ thay giá trị `$DashboardEnv`; không copy secret vào file mới. Mở hoặc sửa ở bất kỳ đường dẫn nào cũng cập nhật cùng một file `.env` vật lý.

Cài và chạy bot. Bot dùng `BOT_PORT=3001` local để port `3000` được dành cho dashboard:

```powershell
cd C:\Users\quock\OneDrive\Desktop\werewolf-bot
npm ci
npm run build
npm run dev
```

Kiểm tra health endpoint trong PowerShell khác:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
```

Kết quả hợp lệ là JSON có `status` bằng `ok`. Gateway `/internal/dashboard/...` phải trả `401` nếu thiếu secret; đó là hành vi đúng.

## 3. Local: cài và chạy dashboard

Dashboard đọc `.env` qua hard link ở bước trước, bao gồm cả `WEREWOLF_BOT_DASHBOARD_URL`. Cài, migrate và chạy dashboard:

```powershell
cd C:\Users\quock\OneDrive\Desktop\werewolf-dashboard
corepack enable
pnpm install --frozen-lockfile
pnpm drizzle-kit migrate
pnpm dev
```

Mở `http://localhost:3000/dashboard`. Nếu JWT cookie hợp lệ, dashboard hiển thị ngay. Nếu cookie không tồn tại, hết hạn, hoặc token bị thay đổi, hệ thống tự chuyển sang `http://localhost:3000/dashboard/login`; sau khi đăng nhập thành công, user được đưa trở lại trang dashboard ban đầu. Token chỉ nằm trong cookie `HttpOnly`; không có token hard-code, query string token, hay bypass xác thực.

> Không mở `http://localhost:3000/internal/dashboard/...` để xem dữ liệu. Đây là gateway bot tại `http://127.0.0.1:3001`, được bảo vệ bằng secret server-to-server và không dành cho browser.

Để xác minh hợp đồng gateway với bot đang chạy thật, mở PowerShell trong dashboard repository và chạy kiểm thử opt-in sau. Test mặc định không gọi URL tunnel/production để không biến lỗi mạng tạm thời thành lỗi unit test.

```powershell
$env:RUN_LIVE_GATEWAY_TEST = 'true'
pnpm test -- server/dashboardGateway.credentials.test.ts
Remove-Item Env:RUN_LIVE_GATEWAY_TEST
```

## 4. Render: Environment Group dùng chung

Trong Render Dashboard, tạo Environment Group tên:

```text
werewolf-gateway-shared-prod
```

Group chỉ chứa **một biến**:

```env
DASHBOARD_GATEWAY_SECRET=<GatewaySecret-moi-danh-rieng-cho-production>
```

Gắn group này vào cả `werewolf-bot-prod` và `werewolf-dashboard-prod`. Environment Group là nguồn cấu hình chung có thể link vào nhiều service [1]. Không đưa `TELEGRAM_BOT_TOKEN`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET` hoặc password admin vào group này.

## 5. Render: deploy bot

Khuyến nghị tạo service tên `werewolf-bot-prod` dạng **Private Service**, ở cùng workspace và region với dashboard. Bot Telegram dùng long polling outbound nên không cần public URL; dashboard vẫn gọi bot qua Render private network. Private Service không public Internet nhưng service cùng private network vẫn gọi được [2] [3].

| Mục Render | Giá trị |
|---|---|
| Service type | Private Service |
| Root directory | Thư mục repo bot |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Environment Group | `werewolf-gateway-shared-prod` |

Biến riêng của **bot service**:

```env
NODE_ENV=production
TELEGRAM_BOT_TOKEN=<production-token-tu-BotFather>
REDIS_URL=rediss://<managed-redis-host>:<port>/<db>
LOG_LEVEL=info
MUTE_DEAD_PLAYERS=true
```

Không tự đặt `PORT` trừ khi Render yêu cầu. Bot mặc định `3000`; sau deploy, mở **Connect → Internal** và copy chính xác Service Address, ví dụ:

```text
http://werewolf-bot-prod-xxxx:3000
```

Render private network dùng hostname nội bộ ổn định; không dùng IP nội bộ tự đoán [3].

## 6. Render: deploy dashboard

Tạo Web Service tên `werewolf-dashboard-prod`, **cùng region** với bot. Dashboard là trang người dùng mở trên trình duyệt nên cần Web Service public.

| Mục Render | Giá trị |
|---|---|
| Service type | Web Service |
| Root directory | Thư mục repo dashboard |
| Build Command | `corepack enable && pnpm install --frozen-lockfile && pnpm build` |
| Start Command | `corepack enable && pnpm start` |
| Environment Group | `werewolf-gateway-shared-prod` |
| Health check | `/` |

Biến riêng của **dashboard service**:

```env
NODE_ENV=production

# Bắt buộc là MySQL/TiDB, vì schema hiện tại dùng Drizzle mysql.
DATABASE_URL=mysql://<username>:<password>@<mysql-host>:<port>/<dashboard_database>

JWT_SECRET=<JwtSecret-moi-danh-rieng-cho-production>

# Dán Service Address nội bộ đã copy ở bước 5.
WEREWOLF_BOT_DASHBOARD_URL=http://werewolf-bot-prod-xxxx:3000

DASHBOARD_ADMIN_USERNAME=admin_werewolf
DASHBOARD_ADMIN_PASSWORD=<password-rieng-toi-thieu-12-ky-tu>
```

Render yêu cầu Web Service bind theo `PORT` mà Render cung cấp; dashboard đã đọc biến này, nên không hardcode `PORT` production [4]. Dashboard hiện dùng MySQL/TiDB; **không** thay `DATABASE_URL` bằng Render Postgres nếu chưa đổi dialect/schema.

### Migrate database dashboard

Trước khi dashboard phục vụ người dùng, mở Render Shell của dashboard và chạy một lần:

```bash
corepack enable && pnpm drizzle-kit migrate
```

Sau migration, dùng **Manual Deploy → Deploy latest commit** nếu cần restart service. Chỉ sau đó login admin lần đầu. Sau khi login thành công, có thể xóa `DASHBOARD_ADMIN_PASSWORD`; không xóa `JWT_SECRET`, `DATABASE_URL`, `WEREWOLF_BOT_DASHBOARD_URL` hoặc Environment Group.

## 7. Checklist xác minh production

| Kiểm tra | Kết quả mong đợi |
|---|---|
| Log bot | Bot connect Telegram, Redis không lỗi, HTTP server start. |
| Dashboard login | Username/password admin đăng nhập được. |
| Dashboard overview | Có phòng thật hoặc trạng thái empty, không có dữ liệu giả. |
| Khi bot tắt | Dashboard hiển thị unavailable, không crash. |
| Gateway | Không có role, team, vote target, night action hoặc raw event payload. |
| Secret | `DASHBOARD_GATEWAY_SECRET` chỉ ở Environment Group, không trong Git/log/chat. |

## 8. Lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Dashboard `unavailable` | URL bot là URL public cũ, sai internal URL, hoặc secret không khớp | Copy lại Connect → Internal của bot; kiểm tra cả hai service link cùng Environment Group. |
| Dashboard không login được | Chưa migrate database hoặc admin bootstrap password không hợp lệ | Chạy `pnpm drizzle-kit migrate`; password tối thiểu 12 ký tự; kiểm tra username `3–32` ký tự chữ/số/`_`/`-`. |
| Bot không start Render | `REDIS_URL` thiếu/sai hoặc token Telegram thiếu | Kiểm tra variables riêng bot và dùng managed Redis URL production. |
| Không có room | Không có room active trong Redis | Đây là state đúng; tạo/join một game thật để kiểm tra. |
| Dùng `localhost` trên Render | `localhost` trỏ chính service đó | Dùng Internal Service Address của bot trong dashboard. |

## References

[1] [Render — Environment Variables and Secrets](https://render.com/docs/configure-environment-variables)

[2] [Render — Private Services](https://render.com/docs/private-services)

[3] [Render — Private Network](https://render.com/docs/private-network)

[4] [Render — Web Services and Port Binding](https://render.com/docs/web-services)
