# Werewolf Telegram Bot — Role Specifications

**Status:** Canonicalization draft based on `RoleRegistry`, role implementations, role-distribution strategy, and executable acceptance tests. Runtime rules are not invented where evidence is incomplete.

## Shared role contract

Every role has a stable `RoleId`, a team/faction, a role definition, and optional night-action capability. Assignment is randomized by `RoleAssigner` after a distribution plan is computed. A role-private message must be delivered through the private Telegram channel; public messages must never reveal a player's role unless the game-end rule explicitly permits reveal.

## Role matrix

| Role | Faction | Objective | Ability | Phase | Target | Limit | Information visibility | Win |
|---|---|---|---|---|---|---|---|---|
| **Dân làng** (`VILLAGER`) | Dân | Tìm và loại phe Sói | Không có night ability; participates in discussion and vote | Ngày / Bỏ phiếu | Vote target must follow current vote rules | One vote per voting cycle; exact vote-change rule must follow resolver | Public vote result; no private role information | Phe Dân thắng when canonical wolf-win condition is met in code |
| **Sói** (`WEREWOLF`) | Sói | Loại phe Dân | Selects a living target for the night attack | Đêm | Living, valid non-wolf target according to current validator | One resolved wolf kill per night; wolf coordination semantics are code-defined | Wolf-only target/action information; no leak to village | Phe Sói wins when canonical wolf-win condition is met in code |
| **Tiên tri** (`SEER`) | Dân | Hỗ trợ phe Dân xác định phe Sói | Investigates a living target and receives alignment/role result according to current implementation | Đêm | Living valid target; self-target rule must follow role validator | One investigation per night | Result is role-private | Phe Dân |
| **Bảo vệ** (`BODYGUARD`) | Dân | Bảo vệ người chơi khỏi night attack | Protects a living target | Đêm | Living valid target; self-protect controlled by `bodyguardAllowSelfProtect` | One protection per night; consecutive-target restriction is enforced by service/state | Action result is private; protection outcome is not a role reveal | Phe Dân |
| **Phù thủy** (`WITCH`) | Dân | Dùng dược để cứu hoặc loại mục tiêu | Save/heal and poison actions are modeled independently | Đêm | Save/poison target rules are validated by `NightActionService` and `WitchRole` | Potion inventory is tracked per match; each potion is single-use according to current state | Potion status and action result are private | Phe Dân |
| **Thợ săn** (`HUNTER`) | Dân | Gây ảnh hưởng sau khi chết | May select a revenge target on death when the current death trigger permits it | Death resolution / post-death trigger | Valid living target at resolution time | One revenge shot; exact trigger priority follows `DeathQueue`/resolver | Public death; target/action result follows current death-resolution policy | Phe Dân |
| **Pháp sư câm** (`SILENT_MAGE`) | Dân | Hỗ trợ phe Dân bằng cách hạn chế thảo luận của một mục tiêu | Mutes/silences a target for the configured discussion cycle | Đêm → ảnh hưởng Ngày | Valid living target; dead-target and self-target rules follow role validator | One silence action per night/cycle; không được chọn cùng một mục tiêu trong hai đêm liên tiếp | The silence effect may be public or private only as defined by `BotPolicy`/`DayService`; do not reveal role | Phe Dân |

## Silent Mage consecutive-target rule

After a Silent Mage silence target is resolved for a night, that target is persisted per match. On the next night, selecting the same living target is rejected. Selecting a different valid target or skipping remains subject to the existing role and phase rules. Legacy rooms without this field are treated as having no previous Silent Mage target until the first new resolution is persisted.

## Silent Mage automatic distribution rule

`SILENT_MAGE` is automatically included by the default strategy in every game with 8–15 players. This automatic rule applies even when `room.settings.enabledRoles` is empty or contains another explicit role list. The expected eight-player preset is:

```text
2 Werewolf
1 Seer
1 Bodyguard
1 Hunter
1 Witch
1 Silent Mage
1 Villager
```

For 9–15 players, the same five special roles remain present; the number of Werewolves follows the existing player-count formula and the remaining slots are filled by Dân làng. Below 8 players, Silent Mage is not auto-assigned; an explicit Silent Mage selection remains supported only when the computed plan fits the player-count constraints. Role assignment remains randomized after plan creation.

## Role-information policy

Role assignment and role instructions are `ROLE_PRIVATE`. Wolf coordination information is `ROLE_PRIVATE` to wolves. Seer results are private to the Seer. Public messages may announce deaths, phase transitions, vote outcomes, and win results, but must not reveal hidden role data unless the canonical end-game policy explicitly says so.

## Evidence and remaining ambiguity

The current code and tests clearly establish role registration, action validators, Silent Mage distribution, and the Bodyguard/Witch/Hunter stateful rules. The exact public role-reveal policy at game end and the precise wording of Seer results must be extracted from the current presenter/flow code before content migration. These are **MISSING RULE / CONTENT AUDIT ITEMS**, not grounds for inventing new mechanics.
