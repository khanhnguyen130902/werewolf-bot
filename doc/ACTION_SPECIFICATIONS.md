# Werewolf Telegram Bot — Action Specifications

**Status:** Canonical action dictionary grounded in current `NightActionType`, role validators, services, resolvers, and tests.

| Action ID | User-facing label | Actor | Phase | Target | Restrictions | Usage | Effect | Failure conditions |
|---|---|---|---|---|---|---|---|---|
| `WEREWOLF_VOTE_KILL` / `KILL` | 🐺 Tấn công | Sói | Đêm | Living valid target | Target validation must reject invalid/dead/forbidden targets; wolf coordination follows current resolver | One night resolution | Adds/updates wolf kill intent | Invalid phase, invalid target, duplicate/closed action, dead actor |
| `BODYGUARD_PROTECT` / `PROTECT` | 🛡️ Bảo vệ | Bảo vệ | Đêm | Living valid target | Self-protect is configurable; consecutive target restriction is stateful | One per night | Protects target from applicable night attack | Invalid target, forbidden self-protect, consecutive target, closed action |
| `SEER_INSPECT` / `INVESTIGATE` | 🔮 Điều tra | Tiên tri | Đêm | Living valid target | Result must remain private | One per night | Returns configured role/alignment result to Seer | Invalid target, invalid phase, dead actor |
| `WITCH_SAVE` / `HEAL` | 🧪 Cứu | Phù thủy | Đêm | Current wolf victim or allowed save target | Potion inventory and save timing are stateful | Single-use save potion | Prevents applicable death | Potion already used, invalid phase, unavailable victim |
| `WITCH_POISON` / `POISON` | ☠️ Đầu độc | Phù thủy | Đêm | Living valid target | Poison potion inventory and target rules are stateful | Single-use poison potion | Adds poison death to death queue | Potion already used, invalid target, invalid phase |
| `SILENT_MAGE_SILENCE` / `MUTE` | 🤫 Làm câm | Pháp sư câm | Đêm → Ngày | Living valid target | Dead-player and target rules enforced; không được chọn cùng mục tiêu trong hai đêm liên tiếp | One per configured night/cycle | Restricts target discussion according to `BotPolicy`/`DayService`; selected target is persisted per match | Invalid phase, invalid target, dead actor, duplicate action, same target as previous night |
| `HUNTER_SHOOT` / `SHOOT` | 🏹 Bắn trả | Thợ săn | Death resolution | Living valid target | Triggered only when current death rules permit; resolved through death queue | One per hunter death | Adds revenge death to death queue | Invalid trigger, invalid target, already used |
| `VOTE` / `VOTE_CAST` | 🗳️ Bỏ phiếu | Living eligible player | Bỏ phiếu | Living eligible target or configured skip | Vote eligibility and tie behavior follow resolver | One active ballot; updates depend on current policy | Records/updates ballot | Invalid phase, dead voter, invalid target, closed ballot |
| `SKIP` | ⏭️ Bỏ qua | Eligible action actor/voter | Current action/vote phase | No target | Only allowed where the action contract permits it | At most once per open action | Records no target / abstention | Skip not allowed, action already closed |

## Domain/user/button separation

The domain action ID is stable and machine-readable. The player-facing label is Vietnamese and concise. The button label is short and imperative. Events/logs may use a separate event ID such as `NIGHT_ACTION_SUBMITTED` or `PLAYER_PROTECT_TARGET`; these layers must not be coupled to free-form button text.

## Target rules

All target validation belongs to the engine/service layer. Content must describe the rejection reason without exposing hidden role information. A public group message should say “⚠️ Mục tiêu này không hợp lệ.”; a private message may add an actionable reason such as “Hãy chọn một người còn sống trong ván.” when that reason is safe to reveal.

## Resolution priority

The exact priority is determined by the current `NightResolver`, `DeathQueue`, and role-specific state. The canonical chain is: collect actions → resolve wolf/protection/witch effects → enqueue deaths → process death queue and Hunter trigger → check win condition → transition and notify. Any implementation-specific ordering that differs must be recorded as a conflict before changing content.
