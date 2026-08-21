# Direct Timing Test Report — Wolf submits at 55s

## Kết luận

Case đã **PASS**. Test trực tiếp bằng engine/integration fixture xác nhận khi Sói submit mục tiêu tại `t=55s`, trong khi các regular night actions đã hoàn tất, engine chuyển sang `NightPhase.WITCH` ngay lập tức. Witch được cấp **một timer mới 60 giây** cho toàn bộ quyết định Cứu và Độc.

## Evidence

| Assertion | Kết quả |
|---|---|
| Night timer ban đầu | `NIGHT_ACTION_TIMEOUT`, `60,000 ms` |
| Wolf submit tại | `55,000 ms` |
| Remaining night timer ngay trước transition | `5,000 ms` |
| Transition | `FIRST_NIGHT / ACTIONS → FIRST_NIGHT / WITCH` |
| Witch timer | `WITCH_ACTION_TIMEOUT`, `60,000 ms` |
| Witch save và poison | Cùng chung một cửa sổ 60 giây |
| Số timer được tạo | 2: một Night timer + một Witch timer; không có timer thứ ba |
| Night resolution | `FIRST_NIGHT → DAY` |
| Save target | Được cứu, không chết bởi Wolf kill |

## Validation

Build TypeScript: **PASS**.

Targeted regression: **4 suites, 44 tests PASS**, gồm direct timing test, `GameOrchestrator`, `NightActionService` và `GameFlowController`.

Live runtime sau test: node processes vẫn active, HTTP port `3000` vẫn listening, Redis port `6379` vẫn listening. Direct test dùng room fixture độc lập và không mutate room Telegram đang chạy.

## File tạo/thay đổi

Test mới: `tests/engine/WolfAt55WitchWindow.test.ts`.

Report này không thay đổi production logic; nó kiểm chứng contract timer hiện tại.
