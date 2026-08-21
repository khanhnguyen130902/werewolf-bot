# Silent Mage — Báo cáo E2E Regression 200 vòng

**Branch:** `feature/silent-mage`  
**Mục tiêu:** kiểm tra toàn bộ flow liên quan đến Silent Mage, Silence Gate, discussion death, ballot callback và các race/unhappy/edge case với tối thiểu 200 lần chạy.

## 1. Phạm vi và phương pháp

Đợt kiểm thử cuối gồm **400 case-runs độc lập**: 200 full-flow E2E và 200 adversarial E2E. Mỗi case tạo storage, room, event bus, service graph và state machine mới; không dùng state của case trước.

| Nhóm | Số lần | Phạm vi |
| --- | ---: | --- |
| Full-flow E2E | 200 | Start game → FIRST_NIGHT → NIGHT_RESOLVED → DAY → DISCUSSION → VOTING → EXECUTION → CHECK_WIN → GAME_OVER. |
| Silent Mage full-flow | 100 | Luân phiên với Seer; kiểm tra role override, action submit, night completion và game termination. |
| Baseline full-flow | 100 | Seer scenario để bảo đảm flow cũ không bị ảnh hưởng. |
| Adversarial E2E | 200 | 10 scenario unhappy/edge, mỗi scenario 20 lần. |

Test dùng `InMemoryStorageAdapter`, fake clock, deterministic random, fake scheduler và mock Telegram gateway. Vì vậy đây là **application-level E2E/integration regression**, không phải live Telegram/Redis/BullMQ external E2E.

## 2. Full-flow E2E — kết quả 200 vòng

Kết quả metrics chính từ `silent-mage-e2e-200-results.json`:

| Metric | Kết quả |
| --- | ---: |
| Requested runs | 200 |
| Passed runs | 200 |
| Invariant matches | 200 |
| Seer baseline matches | 100/100 |
| Silent Mage runs | 100 |
| Silent Mage invariant matches | 100/100 |
| Final state | 200/200 `GAME_OVER` |
| Total events | 10.000 |
| Total telemetry observations | 1.900 |
| Average elapsed time/run | 5,986 ms |
| Maximum elapsed time/run | 26,326 ms |
| Total CPU user time | 1.125 s |
| Total CPU system time | 0,187 s |
| Maximum heap delta | 4.025.248 bytes |
| Maximum RSS delta | 29.065.216 bytes |

Các invariant được kiểm tra trong mỗi full-flow case gồm: game luôn đạt `GAME_OVER`; event stream không rỗng và chứa `GAME_STARTED`, `ROLES_ASSIGNED`, `NIGHT_RESOLVED`, `EXECUTION_RESOLVED`, `WIN_CONDITION_MET`, `GAME_ENDED`; có discussion; có vote telemetry; Seer giữ baseline 38 events/1 discussion/6 observations; Silent Mage phải phát sinh `SILENT_MAGE_SILENCE` action event.

Silent Mage scenario có 100/100 case kết thúc với invariant đúng. Các case này thường có 3 discussion cycles và 62 events; đây là khác biệt hợp lệ so với Seer baseline, không phải regression.

## 3. Adversarial E2E — kết quả 200 case-runs

Kết quả metrics từ `silent-mage-unhappy-edge-e2e-200-results.json`:

| Scenario | Số lần chạy | Kết quả |
| --- | ---: | --- |
| `opening-not-ready` | 20 | PASS — speech trước announcement activation không giết player. |
| `stale-cycle` | 20 | PASS — cycle ID cũ bị từ chối. |
| `speech-non-silenced` | 20 | PASS — người không bị câm không bị xử lý như violation. |
| `dead-speaker` | 20 | PASS — player đã chết trả `PLAYER_ALREADY_DEAD`, không tạo death lần hai. |
| `duplicate-speech` | 20 | PASS — cùng `speechEventId` chỉ commit một lần. |
| `concurrent-speech` | 20 | PASS — hai speech đồng thời chỉ có một accepted death. |
| `speech-vote-race` | 20 | PASS — speech death và vote callback không tạo duplicate death; final state hợp lệ là `VOTING` hoặc `GAME_OVER` tùy win condition. |
| `stale-ballot` | 20 | PASS — ballot cũ bị reject, ballot hiện tại được chấp nhận. |
| `terminal-speech` | 20 | PASS — speech death đưa room qua `CHECK_WIN` tới `GAME_OVER`; vote sau terminal bị từ chối. |
| `callback-after-transition` | 20 | PASS — callback sau discussion transition chỉ được nhận khi có ballot hiện tại. |
| **Tổng** | **200** | **200/200 PASS** |

Tổng cộng adversarial cases tạo và kiểm tra **880 domain events**. Average elapsed time là **0,592 ms/case**, maximum là **18,919 ms/case**.

## 4. Failure discovery và rerun

Đợt test được chạy theo hướng failure-driven, không bỏ qua assertion không phù hợp. Ba vấn đề trong test harness đã được phát hiện và điều chỉnh:

| Phát hiện | Phân tích | Điều chỉnh |
| --- | --- | --- |
| Dead speaker không throw exception | Contract hiện tại trả object `accepted=false`, `reason=PLAYER_ALREADY_DEAD`; đây là kết quả domain có chủ đích. | Đổi test từ `rejects.toThrow()` sang kiểm tra `accepted=false` và reason chính xác. |
| Speech-vote race có thể kết thúc `GAME_OVER` | Với hai Werewolf, một speech death có thể ngay lập tức kích hoạt win condition. | Assertion chấp nhận `VOTING` hoặc `GAME_OVER`, nhưng vẫn bắt buộc chỉ một speech death. |
| Stale-ballot scenario có thể terminal trước khi ballot được kiểm tra | Fixture có quá nhiều Werewolf cho mục tiêu non-terminal. | Dùng fixture một Werewolf cho stale-ballot và callback-after-transition; giữ terminal fixture riêng. |

Sau các điều chỉnh, combined run cuối cùng pass cả hai suite:

```text
PASS tests/telegram/SilentMageE2E200.e2e.test.ts
PASS tests/engine/SilentMageUnhappyEdgeE2E200.test.ts
Test Suites: 2 passed, 2 total
Tests:       2 passed, 2 total
```

Không có assertion bị skip, không có failure còn lại và không có retry được che giấu trong kết quả cuối. Jest vẫn in cảnh báo chung về `--forceExit`/open handles; đây là đặc tính của test process/service mocks và cần tiếp tục theo dõi trong CI, nhưng không làm fail hai suite.

## 5. Artifact đã tạo

| Artifact | Nội dung |
| --- | --- |
| `tests/telegram/SilentMageE2E200.e2e.test.ts` | 200 full-flow runs, 100 Seer + 100 Silent Mage. |
| `tests/engine/SilentMageUnhappyEdgeE2E200.test.ts` | 200 adversarial case-runs, 10 scenario × 20. |
| `silent-mage-e2e-200-results.json` | Metrics/per-run result của full-flow 200. |
| `silent-mage-unhappy-edge-e2e-200-results.json` | Metrics/per-scenario result của adversarial 200. |
| `silent-mage-e2e-combined-200-run.log` | Log của combined final run. |
| `silent-mage-e2e-200-run.log` | Log full-flow run riêng. |
| `silent-mage-unhappy-edge-e2e-200-run.log` | Log adversarial run riêng. |

## 6. Giới hạn và kết luận readiness

Kết quả **200/200 full-flow và 200/200 adversarial pass** chứng minh tốt các domain/application invariants trong deterministic test environment. Nó không chứng minh hoàn toàn các đặc tính phụ thuộc hạ tầng bên ngoài: Telegram API thực, Redis serialization, BullMQ worker restart, nhiều process/worker đồng thời, network timeout, Telegram duplicate delivery và transactional outbox khi Redis append fail.

Do đó kết luận chính xác là: **Silent Mage và các race fixes đạt mức sẵn sàng cho controlled canary trong test room**, với mức tin cậy cao cho domain/state/orchestration flow. Trước production-wide rollout vẫn cần một vòng canary có Redis/BullMQ thật, kiểm tra restart worker và theo dõi telemetry `STALE_BALLOT`, stale timer, duplicate presentation, speech rejection và unhandled rejection.

Không tự động commit hoặc deploy production trong quá trình kiểm thử này.
