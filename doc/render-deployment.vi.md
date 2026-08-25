# Render deployment — cấu hình môi trường

Bot và dashboard là **hai service riêng**. Mỗi service cần một bảng Environment riêng trong Render hoặc một file `.env` riêng khi chạy local. Không copy `.env` chứa secret vào repository. Để chia sẻ gateway secret an toàn, tạo Environment Group tên `werewolf-gateway-shared-prod` và gắn group này vào cả hai service.

## 1. Bot Web Service

Tại Render service chạy bot, đặt Build Command là `npm run build` và Start Command là `npm start`. Render tự cung cấp `PORT`; không ép cổng production về `3000`.

| Biến | Giá trị trên Render | Mục đích |
|---|---|---|
| `NODE_ENV` | `production` | Bật kiểm tra cấu hình production. |
| `TELEGRAM_BOT_TOKEN` | Token từ BotFather | Kết nối Telegram bot. |
| `REDIS_URL` | `rediss://...` của Redis managed/private | Lưu game state và hàng đợi BullMQ. Không dùng `localhost:6379` trên Render. |
| `LOG_LEVEL` | `info` | Log vận hành production. |
| `MUTE_DEAD_PLAYERS` | `true` hoặc `false` | Chính sách mute hiện có. |
| `DASHBOARD_GATEWAY_SECRET` | Chuỗi ngẫu nhiên dài từ Environment Group | Xác thực request chỉ-đọc từ dashboard. |
| `PORT` | Render tự cấp | Cổng HTTP health/gateway; code đọc `process.env.PORT`. |

> Render public URL của service bot, ví dụ `https://werewolf-bot.onrender.com`, sẽ trở thành giá trị `WEREWOLF_BOT_DASHBOARD_URL` ở **dashboard service**. Nó không phải biến mà bot cần đọc.

## 2. Dashboard Web Service

Dashboard dùng đăng nhập username/password local với JWT HttpOnly; không cần biến OAuth. Đặt các biến sau trong service dashboard:

| Biến | Giá trị | Mục đích |
|---|---|---|
| `NODE_ENV` | `production` | Chế độ production. |
| `DATABASE_URL` | MySQL/TiDB external URL | Lưu user, username và password hash. |
| `JWT_SECRET` | Chuỗi ngẫu nhiên dài, riêng tư | Ký JWT session 8 giờ. |
| `WEREWOLF_BOT_DASHBOARD_URL` | `https://<bot-service>.onrender.com` | URL gốc bot gateway. Không thêm `/internal/dashboard/rooms`. |
| `DASHBOARD_GATEWAY_SECRET` | Chuỗi ngẫu nhiên dài từ Environment Group | Xác thực server-to-server. |
| `DASHBOARD_ADMIN_USERNAME` | Username admin đầu tiên | Seed admin khi chưa có local admin. |
| `DASHBOARD_ADMIN_PASSWORD` | Password riêng, tối thiểu 12 ký tự | Chỉ seed password hash lần đầu. |
| `PORT` | Render tự cấp | Không hardcode cổng production. |

## 3. Trình tự triển khai

Đầu tiên tạo Environment Group `werewolf-gateway-shared-prod` với đúng một biến `DASHBOARD_GATEWAY_SECRET=<random-secret>`, rồi gắn group vào cả bot lẫn dashboard. Tiếp theo triển khai bot với Redis production. Sau khi Render cấp URL HTTPS của bot, đặt URL đó vào `WEREWOLF_BOT_DASHBOARD_URL` của dashboard. Cuối cùng triển khai dashboard, đăng nhập bằng admin bootstrap và kiểm tra danh sách room.

Temporary Cloudflare tunnel chỉ dành cho test local. Khi deploy production, xóa URL `trycloudflare.com` khỏi dashboard secrets và dùng URL HTTPS Render của bot.
