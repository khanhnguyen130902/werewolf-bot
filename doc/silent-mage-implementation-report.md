# Silent Mage — Implementation Readiness Report

**Branch:** `feature/silent-mage`  
**Trạng thái:** Đã triển khai trong branch riêng; role vẫn **tắt mặc định** vì `DEFAULT_GAME_SETTINGS.enabledRoles` không tự thêm Silent Mage.  
**Ngày kiểm tra:** 2026-08-18

## 1. Phạm vi đã triển khai

Implementation đã bổ sung `RoleId.SILENT_MAGE`, `NightActionType.SILENT_MAGE_SILENCE` và `DeathCause.SPOKEN_WHILE_SILENCED`; tạo `SilentMageRole`; đăng ký role trong `RoleRegistry`; thêm action mapping cho night submission, callback handler và GameFlowController; thêm alias `/bottest phapsucam`, `/bottest silentmage` và `/bottest silentwizard`.

Night resolution áp dụng silence sau Witch poison theo `nightActionOrder`. Action đã submit vẫn được giữ khi caster chết cùng đêm. Target chết trong cùng night không nhận silence. Silence metadata cũ được dọn trước khi persist target mới.

Day lifecycle đã thêm persisted opening gate: `OPENING` trước khi public announcement hoàn tất và `ACTIVE` chỉ sau khi Telegram announcement thành công. `discussionCycleId`, `discussionEnforcementReady`, deadline và silence-cycle identity được lưu qua room state. Startup overdue resume không chuyển `DISCUSSION` sang `VOTING` khi gate chưa active.

Speech enforcement chỉ xử lý message types được whitelist gồm text, voice, sticker và GIF/animation. Command và callback query không đi qua speech gate. Discussion speech violation được xử lý atomic với optimistic retry, idempotency, Hunter prompt/timeout, death event, win check và transition `DISCUSSION → CHECK_WIN → VOTING|GAME_OVER`.

BotPolicy có `canSpeak`, silence-cycle awareness và speech-attempt/blocked telemetry. Bot discussion scheduler kiểm tra gate trước khi gửi; callback vote vẫn là luồng độc lập và không bị `canSpeak` chặn.

## 2. Test gates đã chạy

| Gate | Kết quả |
| --- | --- |
| TypeScript build (`npm run build`) | PASS |
| Silent Mage role/night/day/BotPolicy dedicated suites | PASS; 19 dedicated tests |
| Core engine + callback + BotPolicy regression | PASS; 22 suites, 230 tests |
| Redis/BullMQ adapter + callback integration | PASS; 3 suites, 27 tests; adapter tests no-op phần cần Redis khi localhost Redis không khả dụng |
| Existing BottestFlow E2E | PASS; 1 suite, 1 test |
| Existing BottestStress100 E2E | PASS; 1 suite, 1 test |
| `git diff --check` | PASS |
| Full `npm test -- --runInBand` | Không hoàn tất trong 300 giây; đã dừng để tránh treo môi trường. Không được coi là PASS toàn bộ suite. |

Trong quá trình test đã phát hiện và sửa một race thực tế: optimistic retry có thể làm rò rỉ biến `accepted=true` từ attempt bị conflict sang attempt retry. Contract hiện reset toàn bộ captured side effects ở đầu mỗi retry; race test xác nhận hai speech event đồng thời chỉ commit một death.

## 3. Canary và rollback gate

Canary thực với Telegram/Redis production chưa chạy trong sandbox này. Trước khi bật role cho nhóm thật, cần chạy một test room bằng `/bottest phapsucam 6`, xác nhận public announcement, silence target, speech violation, Hunter prompt và callback vote. Sau đó cần restart process giữa `OPENING`, `ACTIVE` và `VOTING` để xác nhận recovery.

Rollback an toàn ở mức cấu hình là không đưa `SILENT_MAGE` vào `enabledRoles`; các ván không bật role sẽ tiếp tục dùng flow cũ. Nếu cần rollback code, dừng feature branch/deploy mới và quay về revision trước implementation; không nên xóa persisted fields vì legacy room snapshot có thể còn chứa silence metadata.

## 4. Giới hạn còn lại

Full Jest command chưa có kết quả hoàn tất do có suite hoặc handle nền vượt quá thời gian 300 giây. Redis/BullMQ integration đầy đủ cần chạy trong môi trường có Redis thật. Canary Telegram cần bot token, group chat và quyền xóa message thực tế; các bước này chưa được thực hiện tự động.

Vì vậy trạng thái hiện tại là **ready for controlled canary**, chưa phải **production-wide ready**. Chỉ nên bật production sau khi canary pass, full suite được phân loại nguyên nhân timeout, Redis/BullMQ test chạy thật và kiểm tra restart/resume đã hoàn tất.
