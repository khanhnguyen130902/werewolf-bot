# Werewolf Telegram Bot — Message Catalog

**Status:** Canonical catalog baseline. Message IDs are stable keys; exact existing text should be migrated into a typed content layer after the remaining presenter audit.

| Message ID | Event/trigger | Audience | Visibility | Priority | Canonical content intent |
|---|---|---|---|---|---|
| `HELP.OVERVIEW` | `/help` | All users | PUBLIC/PRIVATE request context | INFO | Production onboarding and verified command list |
| `ONBOARDING.DM_REQUIRED` | User needs private setup | Player | PLAYER_PRIVATE / public CTA | HIGH | Explain that `/start` in DM is required before role/action delivery |
| `GAME.CREATED` | Room created | Group participants | PUBLIC | HIGH | Confirm room is open and show next action |
| `GAME.JOINED` | Player joins room | Group participants | PUBLIC | INFO | Confirm player joined and current count |
| `GAME.LEFT` | Player leaves lobby | Group participants | PUBLIC | INFO | Confirm player left before game start |
| `GAME.STATUS` | `/status` | Requesting user/group | PUBLIC | INFO | Show room and game state without hidden roles |
| `GAME.STARTING` | Host starts game | Group participants | PUBLIC | HIGH | Announce transition and private role delivery |
| `ROLE.ASSIGNED` | Role assignment | Player | ROLE_PRIVATE | HIGH | Tell player role, faction, objective, ability, timing, and limits |
| `PHASE.NIGHT.STARTED` | Night transition | Group + eligible players | PUBLIC + PLAYER_PRIVATE | HIGH | Announce night and send eligible role action prompts |
| `ACTION.REQUESTED.KILL` | Wolf night prompt | Wolf | ROLE_PRIVATE | HIGH | Ask Wolf to choose an eligible living target |
| `ACTION.REQUESTED.PROTECT` | Bodyguard night prompt | Bodyguard | ROLE_PRIVATE | HIGH | Ask Bodyguard to choose protection target |
| `ACTION.REQUESTED.INVESTIGATE` | Seer night prompt | Seer | ROLE_PRIVATE | HIGH | Ask Seer to choose investigation target |
| `ACTION.REQUESTED.HEAL` | Witch save prompt | Witch | ROLE_PRIVATE | HIGH | Show save option and remaining potion state |
| `ACTION.REQUESTED.POISON` | Witch poison prompt | Witch | ROLE_PRIVATE | HIGH | Show poison option and remaining potion state |
| `ACTION.REQUESTED.MUTE` | Silent Mage prompt | Silent Mage | ROLE_PRIVATE | HIGH | Ask Silent Mage to choose a valid silence target |
| `ACTION.COMPLETED` | Action accepted | Acting player | PLAYER_PRIVATE | INFO | Confirm action was recorded without leaking hidden results |
| `ACTION.INVALID_PHASE` | Action outside allowed phase | Requesting player | PLAYER_PRIVATE | HIGH | Explain action is not available now |
| `ACTION.INVALID_TARGET` | Target rejected | Requesting player | PLAYER_PRIVATE | HIGH | Explain target is not valid and provide safe next step |
| `ACTION.ALREADY_DONE` | Duplicate action | Requesting player | PLAYER_PRIVATE | INFO | Explain action is already recorded or closed |
| `ACTION.TIMEOUT` | Timer expires | Affected player/group | Appropriate audience | HIGH | Explain the action timed out and the configured fallback was applied |
| `PHASE.DAY.STARTED` | Day/discussion transition | Group participants | PUBLIC | HIGH | Announce morning/day and safe public night result |
| `VOTE.STARTED` | Voting opens | Eligible voters | PUBLIC | HIGH | Explain who may vote, target restrictions, and deadline |
| `VOTE.SUBMITTED` | Vote accepted | Voter/group as configured | PLAYER_PRIVATE or PUBLIC | INFO | Confirm vote recording without exposing private ballot details |
| `VOTE.UPDATED` | Vote changed | Voter | PLAYER_PRIVATE | INFO | Confirm the active vote was updated if policy allows changes |
| `VOTE.INVALID` | Vote rejected | Requesting player | PLAYER_PRIVATE | HIGH | Explain invalid phase/target/eligibility |
| `VOTE.TIE` | Tie resolution | Group | PUBLIC | HIGH | Explain the canonical tie behavior from resolver |
| `PLAYER.DIED` | Death resolved | Group + dead player | PUBLIC + appropriate private | HIGH | Announce death; reveal role only if canonical rule permits |
| `PLAYER.MUTED` | Silent Mage effect | Group/target as configured | PUBLIC or PLAYER_PRIVATE per policy | HIGH | Explain discussion restriction without exposing Silent Mage |
| `GAME.WIN.VILLAGE` | Village win condition | All participants | PUBLIC | HIGH | Announce Dân victory and end-game result |
| `GAME.WIN.WOLF` | Wolf win condition | All participants | PUBLIC | HIGH | Announce Sói victory and end-game result |
| `GAME.ENDED` | Host/system/game end | All participants | PUBLIC | HIGH | Announce game ended and cleanup/new-game eligibility |
| `ERROR.ROOM_NOT_FOUND` | `/join` without room | Requesting user/group | PUBLIC/PLAYER_PRIVATE context | HIGH | “Không tìm thấy phòng chơi này. Có thể phòng đã bị đóng.” |
| `ERROR.DM_REQUIRED` | Room exists but DM unavailable | Player | PLAYER_PRIVATE/public CTA | HIGH | Tell player to send `/start` to bot in private chat |
| `ERROR.PERMISSION_DENIED` | Non-host host action | Requesting user | PLAYER_PRIVATE or PUBLIC | HIGH | Explain host-only action without technical details |
| `ERROR.INVALID_GAME_STATE` | Unsupported lifecycle action | Requesting user | PLAYER_PRIVATE | HIGH | Explain current state and the allowed next action |
| `ERROR.UNEXPECTED` | Unhandled safe error | Requesting user | PLAYER_PRIVATE | CRITICAL | Friendly generic message; details only in system logs |

## Message hierarchy

Announcements use a concise title and short body. Errors explain what cannot happen and what the player should do next. Success messages confirm the recorded result. Role-private messages identify the role and the allowed decision. Technical exception details never enter player-facing content.

## Migration rule

Existing message literals must be mapped to a catalog ID before being rewritten. If two messages have the same semantic but different wording, classify the older variant as `DUPLICATE CONTENT` and keep only the canonical content after tests verify all triggers.
