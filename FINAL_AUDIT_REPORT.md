# Werewolf Telegram Bot — Final Game Rule, Content & Terminology Audit

**Audit scope.** This report consolidates the existing seven-role Werewolf Telegram Bot without adding roles, mechanics, or game modes. It records confirmed behavior, implemented fixes, verification evidence, and unresolved decisions that must not be invented.

## A. Canonical Rules

The game uses a group lobby followed by role assignment, private role/action interaction, public daytime discussion, voting, death resolution, win-condition checks, and cleanup. The canonical player-facing vocabulary is Vietnamese. Public messages announce lifecycle events and outcomes; role assignment, hidden action prompts, and investigation results are private. A living player may act only when their role and the current phase permit it. Target validity, action idempotency, death-queue ordering, timers, and scheduler cleanup remain enforced by the domain and orchestration layers.

The supported role scope is exactly seven roles: Dân làng, Sói, Thợ săn, Tiên tri, Bảo vệ, Phù thủy, and Pháp sư câm. Silent Mage is opt-in and is not automatically assigned when no explicit role enablement is present. When explicitly enabled at eight or more players, the verified expected preset is 2 Sói, 1 Tiên tri, 1 Bảo vệ, 1 Thợ săn, 1 Phù thủy, 1 Pháp sư câm, and 1 Dân làng.

A capacity conflict remains explicit: the Master Prompt states 3–15 players, while the current code default is 20. The code was not silently changed. A domain-owner decision is required before normalizing this value.

## B. 7 Roles

| Role | Faction | Ability | Phase | Target | Limit | Win |
|---|---|---|---|---|---|---|
| Dân làng | Dân | No night ability; discusses and votes | Ngày / Bỏ phiếu | Vote target under resolver rules | One active vote per cycle | Phe Dân |
| Sói | Sói | Selects a living target for the night attack | Đêm | Valid living non-wolf target | One resolved wolf kill per night | Phe Sói |
| Thợ săn | Dân | May revenge-shoot when death rules permit | Phân giải người chết | Valid living target | One revenge shot per death | Phe Dân |
| Tiên tri | Dân | Investigates a living target and receives the configured result privately | Đêm | Valid living target | One investigation per night | Phe Dân |
| Bảo vệ | Dân | Protects a living target from applicable night attack | Đêm | Valid living target | One protection per night; stateful consecutive-target rule | Phe Dân |
| Phù thủy | Dân | Uses save/heal and poison actions | Đêm | Valid save/poison target | Each potion is tracked and single-use according to state | Phe Dân |
| Pháp sư câm | Dân | Silences a living target for the configured discussion cycle | Đêm → Ngày | Valid living target | One silence per configured night/cycle | Phe Dân |

## C. Phases

| Phase | Duration | Actions | Transition | Public Message |
|---|---|---|---|---|
| `WAITING` | Until host starts | `/join`, `/leave`, `/status` | Host starts when minimum rule is satisfied | Phòng đang chờ người chơi |
| `STARTING` | Initialization transition | No player action | Roles and state are persisted | Ván đang bắt đầu |
| `FIRST_NIGHT` | Scheduler-controlled | Role-specific night actions | Required actions resolve or timeout | Đêm đầu tiên bắt đầu |
| Night action flow | Scheduler-controlled | Kill, protect, investigate, heal, poison, mute, skip | Resolution completes | Đêm |
| Day/discussion | Timer/announcement policy | Discussion subject to alive/dead/silence policy | Discussion closes | Thảo luận ban ngày |
| Voting | Timer/announcement policy | Vote or configured skip | Vote closes and resolves | Bỏ phiếu |
| Death resolution | Until death queue is empty | Hunter and death effects are applied | Win check, next phase, or game end | Phân giải người chết |
| Game end | Until cleanup completes | Read result; host may end explicitly | Room cleanup | Kết thúc ván |

## D. Actions

| Action | Actor | Phase | Target | Restriction | Resolution |
|---|---|---|---|---|---|
| `WEREWOLF_VOTE_KILL` / `KILL` | Sói | Đêm | Living valid target | Rejects invalid/dead/forbidden targets | Adds or updates wolf kill intent |
| `BODYGUARD_PROTECT` / `PROTECT` | Bảo vệ | Đêm | Living valid target | Self-protect and consecutive-target rules are stateful | Protects against applicable night attack |
| `SEER_INSPECT` / `INVESTIGATE` | Tiên tri | Đêm | Living valid target | Result remains private | Returns configured result to Seer |
| `WITCH_SAVE` / `HEAL` | Phù thủy | Đêm | Allowed save target | Single-use potion and timing rules | Prevents applicable death |
| `WITCH_POISON` / `POISON` | Phù thủy | Đêm | Living valid target | Single-use poison potion | Adds poison death |
| `SILENT_MAGE_SILENCE` / `MUTE` | Pháp sư câm | Đêm → Ngày | Living valid target | State controls duration and eligibility | Restricts discussion according to policy |
| `HUNTER_SHOOT` / `SHOOT` | Thợ săn | Death resolution | Living valid target | Only after a permitted death trigger | Adds revenge death to queue |
| `VOTE` / `VOTE_CAST` | Living eligible player | Bỏ phiếu | Living eligible target or configured skip | Resolver controls eligibility and tie behavior | Records or updates ballot |
| `SKIP` | Eligible actor/voter | Current action/vote phase | None | Only where the contract permits | Records no target/abstention |

## E. Buttons

| Button | Action | Visible To | Phase |
|---|---|---|---|
| 🐺 Tấn công | `WEREWOLF_VOTE_KILL` | Sói private chat | Đêm |
| 🛡️ Bảo vệ | `BODYGUARD_PROTECT` | Bảo vệ private chat | Đêm |
| 🔮 Điều tra | `SEER_INSPECT` | Tiên tri private chat | Đêm |
| 🧪 Cứu | `WITCH_SAVE` | Phù thủy private chat | Đêm |
| ☠️ Đầu độc | `WITCH_POISON` | Phù thủy private chat | Đêm |
| 🤫 Làm câm | `SILENT_MAGE_SILENCE` | Pháp sư câm private chat | Đêm |
| 🏹 Bắn trả | `HUNTER_SHOOT` | Thợ săn after-death private chat | Phân giải người chết |
| 🗳️ Bỏ phiếu | `VOTE` | Living eligible players | Bỏ phiếu |
| ⏭️ Bỏ qua | `SKIP` | Eligible actor/voter | Current action/vote phase |

Callback payloads remain machine-readable and distinct from labels: action payloads use stable action IDs and target identifiers, with explicit `SKIP` encoding and a parser length guard.

## F. Message Catalog

| Message ID | Event | Audience | Content |
|---|---|---|---|
| `HELP.OVERVIEW` | `HELP_REQUESTED` | Public | Production onboarding and command guide |
| `ERROR.ROOM_NOT_FOUND` | `JOIN_REQUESTED` | Public | Không tìm thấy phòng chơi này. |
| `ERROR.DM_REQUIRED` | `JOIN_REQUESTED` | Player private | Hãy nhắn `/start` trong tin nhắn riêng. |
| `ERROR.INVALID_TARGET` | `ACTION_REJECTED` | Player private | Mục tiêu không hợp lệ; chọn người còn sống. |
| `ACTION.COMPLETED` | `ACTION_SUBMITTED` | Player private | Hành động đã được ghi nhận. |
| `GAME.STARTED` | `GAME_STARTED` | Public | Ván bắt đầu; kiểm tra tin nhắn riêng. |
| `PLAYER.DEAD` | `PLAYER_DIED` | Public | Một người chơi đã chết. |
| `GAME.WIN.VILLAGE` | `WIN_CONDITION_MET` | Public | Phe Dân chiến thắng. |
| `GAME.WIN.WOLF` | `WIN_CONDITION_MET` | Public | Phe Sói chiến thắng. |

The typed catalog carries stable IDs, event names, audience, priority, and text. Legacy `messages.ts` now delegates the confirmed DM-required and invalid-target strings to the canonical catalog. Other legacy literals remain documented migration work because replacing them safely requires preserving contextual placeholders and visibility semantics.

## G. Glossary

| Concept | Canonical | Forbidden Alternatives |
|---|---|---|
| Villager | Dân làng | Dân, Nông dân when used as the role label |
| Werewolf | Sói | Ma sói, Người sói in canonical role labels |
| Hunter | Thợ săn | Xạ thủ |
| Seer | Tiên tri | Nhà tiên tri when a compact role label is required |
| Bodyguard | Bảo vệ | Vệ sĩ |
| Witch | Phù thủy | Phù thủy độc, Witch |
| Silent Mage | Pháp sư câm | Pháp sư im lặng, 🧞 label |
| Night | Đêm | Ban đêm when used as a phase title |
| Day discussion | Thảo luận ban ngày | Trao đổi ngày |
| Vote | Bỏ phiếu | Vote, Bình chọn in player-facing controls |
| Target | Mục tiêu | Đối tượng when referring to an action target |
| Action recorded | Hành động đã được ghi nhận | Đã chọn, Đã submit |
| Game end | Kết thúc ván | Game over, Trò chơi kết thúc |

## H. Inconsistencies Found

| ID | Type | Current | Canonical | Fix |
|---|---|---|---|---|
| F-001 | High conflict | Code default max 20; Master Prompt max 15 | Pending owner decision | Preserved code; documented conflict; do not silently change |
| F-002 | High implementation bug | `/join` could check DM reachability before room existence | Room-not-found precedence | Fixed in `RoomService`; regression tests added |
| F-003 | Medium content bug | `/help` was flat and incomplete | Structured Vietnamese onboarding | Migrated to `CANONICAL_HELP_TEXT` |
| F-004 | High content/security risk | Private/public literals are distributed across controllers and presenters | Audience-tagged canonical catalog plus policy gates | Catalog and tests added; complete controller migration remains |
| F-005 | Medium rule/content gap | Silent Mage omitted from default special list | Explicit opt-in; verified 8-player preset | Strategy and distribution tests added |
| F-006 | Medium ambiguity | End-game role reveal policy is not fully extracted | Preserve evidence boundary | No invented rewrite; requires domain decision/evidence |
| F-007 | Medium ambiguity | Tie/no-majority wording requires resolver confirmation | Preserve neutral content | Requires targeted resolver decision/test |
| F-008 | Medium architecture gap | Message literals remain in legacy/controller paths | Incremental typed catalog migration | Highest-risk confirmed strings migrated; remainder tracked |

## I. Code Changes

The implementation adds `src/telegram/presenters/canonicalContent.ts`, migrates `/help` to the canonical help text, delegates confirmed high-risk `needDmFirst` and `invalidTarget` strings in `messages.ts`, fixes `/join` error precedence, adds explicit Silent Mage distribution support, and removes an unsafe `any` cast in `GameFlowController.ts`. The repository also contains the eight canonical Markdown documents and the new canonical content regression suite.

## J. Tests Added and Verification

The new content regression suite verifies seven role names and emojis, seven night-action labels, unique message IDs with audience metadata, and Telegram help length/command coverage. Existing focused regression suites cover `/help`, `/join`, missing-room precedence, and Silent Mage distribution.

| Verification | Result |
|---|---|
| ESLint | Pass |
| TypeScript build | Pass |
| `git diff --check` | Pass |
| Focused feature/content regression | 16/16 pass before final migration; 7/7 pass after final migration |
| Non-stress Jest suites | 50 suites, 369 tests pass |
| Full Jest suite | Timed out at 240 seconds; no completed aggregate result |
| `BottestStress100.e2e.test.ts` alone | Timed out at 180 seconds; requires separate investigation |

The timeout is treated as a verification blocker, not as a pass. The dev server processes remained running separately and were not killed during cleanup.

## K. Remaining Ambiguities and Release Gates

The following are the only unresolved items that cannot be safely inferred from the available evidence. First, the domain owner must decide whether the supported player capacity is 15 or 20. Second, the exact end-game role reveal policy must be extracted from the current behavior and confirmed. Third, tie/no-majority behavior must be confirmed from the vote resolver and converted into a canonical rule. Fourth, the remaining controller-level message literals need a visibility-aware migration so F-004 and F-008 are fully closed. Finally, the two long-running stress/E2E suites must be isolated and made to finish deterministically before claiming full production readiness.

**Release assessment:** the audit baseline, canonical documents, targeted implementation, and non-stress regression coverage are complete and consistent within the evidence boundary. The repository should not be labeled fully production-ready until the capacity decision, remaining visibility migration, resolver ambiguities, and stress-suite timeout are closed.
