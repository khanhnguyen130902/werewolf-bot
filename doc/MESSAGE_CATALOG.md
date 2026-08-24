# Werewolf Telegram Bot — Dark Horror & Friendly Message Catalog

**Status:** Canonical event-to-content map. This catalog standardizes player-facing narrative while preserving the existing game rules, role mechanics, state transitions, visibility, and callback contracts.

## Message architecture

Every message follows the trace:

```text
Canonical event → Audience → Gameplay meaning → Tone layer → Primary content → Optional variant → Button → Expected action
```

Clarity, rule accuracy, and actionability take precedence over atmosphere. Public content never reveals hidden role or action information unless the canonical game rule explicitly permits it.

| Message ID | Event / trigger | Audience | Purpose | Layer | Primary content direction | Variants | Related button | Visibility |
|---|---|---|---|---|---|---|---|---|
| `HELP.OVERVIEW` | `/help` | Requesting user | Explain commands and first steps | Gameplay | Clear onboarding with a restrained village-at-night identity | No random variation | Command list | Public or private request context |
| `ERROR.ROOM_NOT_FOUND` | `/join` without room | Requesting user/group | Explain that no room exists | Pure system | Direct warning with one gentle atmospheric cue | None | `/create` is the next action | Public |
| `ERROR.DM_REQUIRED` | DM not reachable | Player | Explain the required `/start` setup | Pure system | Short CTA with a private-chat link | None | `/start` | Player private or public CTA |
| `GAME.CREATED` | Room created | Group participants | Confirm the lobby is open | Narrative | A new night is approaching; explain `/join` and host next step | Two short lobby variants may be used | `/join` | Public |
| `GAME.JOINED` | Player joins | Group participants | Confirm player and count | Gameplay | Player has entered the village; keep count explicit | Optional short wording variants | None | Public |
| `GAME.LEFT` | Player leaves lobby | Group participants | Confirm departure | Gameplay | A place has opened; do not imply death | Optional short wording variants | None | Public |
| `GAME.STATUS` | `/status` | Requesting user/group | Show state and counts | Pure system | Accurate status first; no hidden roles | None | Available command | Public |
| `GAME.STARTING` | Host starts | Group participants | Announce lock and role delivery | Narrative | Everyone takes position; DM instruction is explicit | Two short transition variants | None | Public |
| `ROLE.ASSIGNED` | Role assignment | Player | Explain role, ability, timing, limits, objective | Gameplay | Role-specific personality language, but exact mechanics remain explicit | None | Role action buttons | Role private |
| `PHASE.NIGHT.STARTED` | Night transition | Group + eligible players | Explain night and private action flow | Narrative / Gameplay | Silence and moonlight followed by the clear DM CTA | Three equivalent night variants | Role action buttons | Public + eligible private |
| `ACTION.REQUESTED.KILL` | Wolf prompt | Sói | Ask for a valid living target | Gameplay | Darkness favors the pack; choose target clearly | None | `🐺 Tấn công` | Role private |
| `ACTION.REQUESTED.PROTECT` | Bodyguard prompt | Bảo vệ | Ask for protection target | Gameplay | Quiet protection; target CTA is explicit | None | `🛡️ Bảo vệ` | Role private |
| `ACTION.REQUESTED.INVESTIGATE` | Seer prompt | Tiên tri | Ask for investigation target | Gameplay | A veil may lift; do not promise a result beyond the rule | None | `🔮 Điều tra` | Role private |
| `ACTION.REQUESTED.HEAL` | Witch save prompt | Phù thủy | Show save availability and target | Gameplay | Quiet power; inventory and action are explicit | None | `🧪 Cứu` | Role private |
| `ACTION.REQUESTED.POISON` | Witch poison prompt | Phù thủy | Show poison availability and target | Gameplay | Dark but non-graphic; inventory and action are explicit | None | `☠️ Đầu độc` | Role private |
| `ACTION.REQUESTED.MUTE` | Silent Mage prompt | Pháp sư câm | Ask for silence target | Gameplay | Silence as a controlled effect; no invented consequence | None | `🤫 Làm câm` | Role private |
| `ACTION.COMPLETED` | Accepted action | Acting player | Confirm action recorded | Gameplay | Short confirmation; no hidden-result leak | None | None | Player private |
| `ACTION.INVALID_PHASE` | Action outside phase | Requesting player | Explain why action is unavailable | Pure system | “Chưa đến lúc” + next-step clarity | None | None | Player private |
| `ACTION.INVALID_TARGET` | Target rejected | Requesting player | Explain invalid target and recovery | Pure system | Choose a living valid target; if the same target was selected on the previous night, choose another target; no role leak | None | Target keyboard | Player private |
| `ACTION.ALREADY_DONE` | Duplicate/closed action | Requesting player | Explain action already recorded | Pure system | Confirmation rather than blame | None | None | Player private |
| `ACTION.TIMEOUT` | Timer expires | Affected player/group | Explain timeout and configured fallback | Pure system | Bot applies the rules; do not promise a specific fallback unless confirmed | None | None | Appropriate audience |
| `PHASE.DAY.STARTED` | Morning transition | Group participants | Report safe public night result | Narrative | Dawn and investigation mood; death semantics stay exact | Two equivalent dawn variants | None | Public |
| `PLAYER.MUTED` | Silence effect | Group/target per policy | Explain restriction without exposing the role | Gameplay | Use “hiệu ứng im lặng”; do not reveal the source role | None | None | Policy-defined |
| `VOTE.STARTED` | Voting opens | Eligible voters | Explain target, deadline, and skip policy | Gameplay | Tension with explicit choice and eligibility | Two short variants | `🗳️ Bỏ phiếu`, `⏭️ Bỏ qua` | Public + eligible private |
| `VOTE.SUBMITTED` | Vote accepted | Voter/group per policy | Confirm vote recording | Gameplay | A ballot has been placed; do not imply outcome | None | None | Policy-defined |
| `VOTE.UPDATED` | Vote changed if allowed | Voter | Confirm active ballot update | Pure system | Direct confirmation | None | None | Player private |
| `VOTE.INVALID` | Vote rejected | Requesting player | Explain invalid phase/target/eligibility | Pure system | Short, calm, actionable | None | Vote keyboard | Player private |
| `VOTE.TIE` | Tie/no-majority result | Group | Explain resolver result | Pure system | Must match resolver; no invented outcome | None | None | Public |
| `PLAYER.DIED` | Death resolved | Group + dead player | Announce death and restrictions | Climax | Atmospheric, non-graphic, exact “đã chết” semantics | Optional narrative variants with same meaning | None | Public + appropriate private |
| `PLAYER.ROLE_REVEALED` | Reveal when rule permits | Group | Announce revealed role | Climax | Short reveal; suppress when rule does not permit | None | None | Rule-defined |
| `GAME.WIN.VILLAGE` | Village condition | All participants | Announce village victory | Climax | Dawn and relief, concise | Optional equivalent win variant | None | Public |
| `GAME.WIN.WOLF` | Wolf condition | All participants | Announce wolf victory | Climax | Silence and darkness, concise | Optional equivalent win variant | None | Public |
| `GAME.ENDED` | Host/system/end condition | All participants | Close story and explain cleanup/new-game state | Climax | A chapter closes; next action remains clear | Optional short ending variant | `/create` when valid | Public |
| `ERROR.PERMISSION_DENIED` | Non-host host action | Requesting user | Explain host-only action | Pure system | Direct and friendly | None | None | Appropriate audience |
| `ERROR.INVALID_GAME_STATE` | Unsupported lifecycle action | Requesting user | Explain current state/next action | Pure system | Accurate state first | None | Contextual command | Player private or public |
| `ERROR.UNEXPECTED` | Unhandled safe error | Requesting user | Recover without technical leak | Pure system | Calm generic retry message | None | None | Player private |

## Canonical term and meaning rules

Use **đã chết** for the gameplay state. Narrative may say “không còn thức dậy” only when the same sentence makes the gameplay result explicit. Do not alternate between “bị loại”, “hy sinh”, “biến mất”, and “không còn tồn tại” as if they were identical state labels.

Use **Mục tiêu**, **Hành động**, **Bỏ phiếu**, **Đêm**, **Ngày**, **Phe Dân**, **Phe Sói**, and **Kết thúc ván** consistently. Narrative variation changes wording, never target restrictions, action availability, win condition, or visibility.

## Migration rule

Each legacy literal must be mapped to a stable catalog ID before rewriting. Duplicate wording is consolidated only when the semantic event, audience, visibility, placeholders, and rule meaning are identical. Any message with uncertain reveal or tie semantics remains explicitly marked for resolver/domain confirmation.
