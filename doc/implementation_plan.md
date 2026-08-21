# Implementation Plan: Phòng trao đổi phe Sói trong ban đêm

## Mục tiêu

Thêm một chế độ trao đổi nội bộ cho phe Sói trong ban đêm, cho phép các Sói còn sống gửi tin nhắn cho bot và bot relay nội dung đó tới các Sói còn sống khác.

Yêu cầu này phải bám sát flow hiện tại của bot:
- ban đêm vẫn dùng prompt riêng qua DM cho từng vai trò;
- hành động chọn mục tiêu vẫn dùng inline keyboard như hiện tại;
- trò chuyện phe Sói không ảnh hưởng đến logic vote/consensus và timeout hiện có;
- nội dung chỉ hiển thị cho phe Sói, không cho người khác.

---

## Context hiện tại của bot

### Flow hiện có
1. Người chơi join phòng và bắt đầu game.
2. Bot gửi vai trò bí mật riêng cho từng người chơi qua DM.
3. Khi đêm bắt đầu, bot gửi prompt riêng cho từng vai trò có hành động ban đêm.
4. Sói hiện tại chọn mục tiêu bằng inline keyboard.
5. Khi đủ hành động hoặc hết timeout, bot tiến hành resolve đêm.
6. Nếu phe Sói không thống nhất mục tiêu, bot gửi thông báo không đồng thuận cho các Sói.

### Các module liên quan
- [src/telegram/GameFlowController.ts](src/telegram/GameFlowController.ts)
  - điều phối việc bắt đầu đêm, gửi prompt, timeout, thông báo phe Sói.
- [src/telegram/handlers/actionCallbackHandler.ts](src/telegram/handlers/actionCallbackHandler.ts)
  - xử lý callback từ inline keyboard cho hành động ban đêm.
- [src/telegram/presenters/messages.ts](src/telegram/presenters/messages.ts)
  - chứa text UI cho role, đêm, thông báo và prompt.
- [src/engine/NightActionService.ts](src/engine/NightActionService.ts)
  - lưu hành động ban đêm và kiểm tra role/target.
- [src/telegram/BotContext.ts](src/telegram/BotContext.ts)
  - context Telegram cho bot.

---

## Phương án chọn

### Phương án D: Bot relay trực tiếp qua tin nhắn riêng giữa bot và Sói

Là phương án phù hợp nhất vì:
- không cần tạo group/chat mới;
- phù hợp với kiến trúc hiện tại đang dùng DM và callback;
- dễ tích hợp vào flow hiện có;
- giữ riêng tư cho phe Sói;
- không xung đột với logic vote và timeout hiện tại.

---

## Tính năng cần triển khai

### 1. Kích hoạt chế độ trao đổi phe Sói
Khi đêm bắt đầu, bot sẽ kích hoạt chế độ trao đổi cho các Sói còn sống.

#### UX
- Bot gửi cho mỗi Sói còn sống một thông báo như:
  - “🐺 Bạn đang ở trong phòng trao đổi phe Sói. Gửi tin nhắn cho bot để trao đổi với các Sói đồng minh.”
- Bot vẫn giữ prompt hành động ban đêm bằng inline keyboard.

#### Điều kiện kích hoạt
- Người dùng là Sói còn sống.
- Room đang ở trạng thái NIGHT hoặc FIRST_NIGHT.
- Chế độ trao đổi chỉ áp dụng cho phe Sói và chỉ trong ban đêm.

---

### 2. Nhận tin nhắn từ Sói và relay cho các Sói khác
Khi một Sói gửi tin nhắn văn bản cho bot trong DM:
- bot nhận tin nhắn;
- kiểm tra người gửi có phải Sói còn sống trong phòng hiện tại không;
- kiểm tra hiện đang ở ban đêm không;
- nếu đúng, bot sẽ relay nội dung tới các Sói còn sống khác.

#### Ví dụ
Người gửi:
- “Đêm nay cắn X.”

Bot gửi tới các Sói khác:
- “🐺 [Tên Sói]: Đêm nay cắn X.”

#### Lưu ý
- Tin nhắn được gửi cho bot sẽ không được forward cho dân làng.
- Tin nhắn chỉ relay tới các Sói còn sống trong phòng hiện tại.

---

### 3. Hỗ trợ lệnh để mở/đóng chế độ trao đổi
Đề xuất thêm các lệnh nhẹ để người dùng tương tác với chế độ này.

#### Lệnh gợi ý
- /soichat
  - mở hoặc kiểm tra trạng thái chế độ trao đổi phe Sói.
- /soichat help
  - hiển thị hướng dẫn ngắn.
- /soichat close
  - đóng chế độ trao đổi (nếu cần).

#### Mặc định
- Nếu không gọi lệnh, bot vẫn tự động bật chế độ khi đêm bắt đầu.

---

### 4. Tách rõ flow chat phe Sói và flow hành động ban đêm
Đây là điểm quan trọng để không làm rối trải nghiệm.

#### Flow 1: Chọn hành động ban đêm
- Vẫn dùng inline keyboard như hiện tại.
- Khi người chơi bấm nút, bot vẫn submit night action vào engine.

#### Flow 2: Trao đổi phe Sói
- Dùng tin nhắn text thông thường.
- Không dùng callback, không dùng keyboard để relay.

#### Nguyên tắc
- Chat phe Sói chỉ là channel phụ, không thay thế prompt hành động.
- Điều này đảm bảo không làm ảnh hưởng đến NightActionService và timeout hiện có.

---

## Thiết kế triển khai

### A. Thêm state mới cho phòng
Không nên tích trực tiếp vào engine domain vì đây là feature Telegram-specific. Nên quản lý ở tầng Telegram layer.

#### Gợi ý dữ liệu cần lưu
- roomId
- round hiện tại
- danh sách Sói còn sống
- trạng thái chat phe Sói đang bật hay không
- thời gian mở/đóng
- optional: last message id hoặc metadata cho audit nhẹ

#### Nơi lưu phù hợp
- Redis adapter hiện có trong project, vì bot đã dùng Redis cho session, timer, prompt message và state lưu tạm.
- Có thể dùng một key riêng như:
  - `wolfchat:room:{roomId}`

---

### B. Thêm một lớp handler cho tin nhắn DM
Hiện tại bot chưa có handler lắng nghe text message ở tầng Telegram. Đây sẽ là phần mới.

#### Logic đề xuất
1. Nếu người gửi không có session phòng → bỏ qua.
2. Nếu không phải Sói còn sống → trả lời thông báo phù hợp.
3. Nếu không đang ở ban đêm → trả lời thông báo “Chỉ dùng trong ban đêm”.
4. Nếu là Sói còn sống và đang ở ban đêm → relay tới các Sói còn sống khác.

#### Gợi ý xử lý
- Bot chỉ nhận text message, không xử lý media, sticker, voice.
- Có thể chặn các command `/start`, `/help`, `/wolfchat` riêng.

---

### C. Tích hợp vào GameFlowController
GameFlowController là nơi phù hợp để mở/đóng chế độ phe Sói vì nó đã biết:
- room hiện tại;
- current round;
- danh sách players;
- trạng thái ban đêm;
- timer và timeout.

#### Các điểm cần chèn vào flow
1. Khi `onGameStarted()` gọi `startNightPrompts(room)`:
   - bot gửi thông báo mở chế độ phe Sói cho các Sói.
2. Khi đêm bắt đầu và cho mỗi Sói còn sống:
   - bật trạng thái chat phe Sói cho phòng.
3. Khi night resolve xong và chuyển sang day:
   - đóng chế độ phe Sói.
4. Khi có người chết hoặc role thay đổi trong đêm:
   - cập nhật lại danh sách Sói còn sống cho relay.

---

### D. Tích hợp với message presenter
Text nên được đặt trong [src/telegram/presenters/messages.ts](src/telegram/presenters/messages.ts) để dễ quản lý và đổi ngôn ngữ sau này.

#### Các message cần thêm
- `wolfChatEnabled`
- `wolfChatDisabled`
- `wolfChatOnlyForWerewolves`
- `wolfChatNightOnly`
- `wolfChatRelayPrefix`
- `wolfChatHelp`

---

## Luồng triển khai từng bước

### Bước 1 — Chuẩn bị nền tảng
- Xác định nơi lưu state cho chat phe Sói.
- Thêm helper để kiểm tra một user có đang là Sói còn sống trong room hiện tại hay không.

### Bước 2 — Thêm handler tin nhắn text
- Lắng nghe tin nhắn trong DM.
- Nếu là tin nhắn bình thường, xử lý theo logic relay phe Sói.

### Bước 3 — Tích hợp vào flow ban đêm
- Khi đêm bắt đầu, bật chế độ cho phòng.
- Khi đêm kết thúc, đóng chế độ.

### Bước 4 — Thêm lệnh hỗ trợ
- /soichat
- /soichat help
- /soichat close

### Bước 5 — Kiểm thử
- Test case 1: Sói gửi tin nhắn trong đêm → relay tới các Sói khác.
- Test case 2: Dân làng gửi tin nhắn trong đêm → bị từ chối.
- Test case 3: Sau khi đêm kết thúc → không còn relay nữa.
- Test case 4: Tín hiệu không ảnh hưởng đến night action submission.

---

## Các ràng buộc kỹ thuật

### Không làm đổi logic engine hiện tại
- Không sửa `NightActionService` để xử lý chat phe Sói.
- Chat phe Sói là feature Telegram-layer, không phải domain logic.

### Không làm ảnh hưởng đến callback action hiện tại
- Inline keyboard hiện tại cho hành động ban đêm vẫn hoạt động bình thường.
- Callback handler cho `action:` và `hunter-shot:` vẫn giữ nguyên.

### Không làm ảnh hưởng đến timeout hiện tại
- Timer cho đêm và day vẫn giữ nguyên.
- Chat phe Sói chỉ là feature phụ, không dùng timer riêng.

---

## Các vấn đề cần cân nhắc trong triển khai

### 1. Bảo mật và riêng tư
- Chỉ relay cho các Sói còn sống.
- Không forward cho dân làng.
- Không gửi tin nhắn này vào group chính.
- Có thể giới hạn kích thước nội dung nếu cần.

### 2. Tránh spam và lẫn lộn
- Nếu người chơi gửi nhiều tin nhắn liên tục, bot có thể relay từng tin một.
- Có thể chèn prefix như “🐺 [Tên]” để phân biệt rõ người gửi.

### 3. Chống lỗi khi người chơi đổi role hoặc chết
- Nếu một Sói chết trong đêm, bot không nên còn relay tới họ nữa.
- Khi round đổi, cần cập nhật danh sách đúng.

### 4. Tránh xung đột với command bot
- `/start`, `/help`, `/wolfchat` phải được xử lý trước khi xem tin nhắn như chat phe Sói.

---

## Đề xuất ưu tiên phát triển

### Ưu tiên 1
- Bật/tắt chế độ chat phe Sói khi đêm bắt đầu/kết thúc.
- Relay tin nhắn text từ Sói sang các Sói còn sống khác.

### Ưu tiên 2
- Thêm lệnh `/wolfchat` và `/wolfchat help`.

### Ưu tiên 3
- Thêm thông báo UI rõ ràng tại lúc đêm bắt đầu.

### Ưu tiên 4
- Tối ưu bảo mật và hạn chế spam.

---

## Kết luận

Phương án này có thể triển khai tốt trên kiến trúc hiện tại vì bot đã có sẵn:
- DM riêng cho player;
- flow đêm và callback action;
- storage Redis để lưu state;
- layer Telegram để xử lý message và command.

Việc triển khai cần giữ nguyên flow hiện tại và chỉ thêm một lớp “private relay channel” ở tầng Telegram, không chạm vào logic game engine.
