# Werewolf Telegram Bot — Phase Specifications

**Status:** Canonical draft. State IDs are kept separate from Vietnamese player-facing terms. Any state not explicitly confirmed by the current enum/tests remains marked for audit.

## Lifecycle

| Phase/state | Canonical display | Purpose | Eligible players | Allowed actions | Start trigger | End trigger | Timeout behavior | Transition |
|---|---|---|---|---|---|---|---|---|
| `WAITING` | Đang chờ người chơi | Group room exists and accepts lobby operations | Joined/alive lobby participants | `/join`, `/leave`, `/status`; host room controls | `/create` | Host starts when minimum player rule is satisfied | No night action timer | `STARTING` or game-start transition |
| `STARTING` | Đang bắt đầu ván | Assign roles and initialize match state | All players in the room | No player action during transition | Host `/startgame` | Roles assigned and initial state persisted | Fail safely; no partial start | `FIRST_NIGHT` or first playable phase |
| `FIRST_NIGHT` | Đêm đầu tiên | Initial private role/night setup | Living players with a night capability | Role-specific night actions allowed by current role policy | Game start | All required actions submitted or scheduler timeout | Per-role no-action behavior; scheduler-driven | Day/discussion or next resolver state |
| Night action flow | Đêm | Resolve role actions for the current round | Living players whose role can act | `KILL`, `PROTECT`, `INVESTIGATE`, `HEAL`, `POISON`, `MUTE`, `SKIP` as applicable | Night transition | All required actions resolved or timeout | `RoomTimerService`/scheduler invokes configured fallback | Day/discussion |
| Day/discussion | Thảo luận ban ngày | Public discussion after night resolution | Living players; dead players are restricted by `BotPolicy` | Discussion messages subject to silence/dead-player policy | Night resolution | Discussion timer/announcement policy | Current implementation may mute/silence a target; exact deadline policy must remain code-driven | Voting |
| Voting | Bỏ phiếu | Select an execution target | Living eligible voters | `VOTE` and allowed vote update/skip behavior | Day discussion transition | Vote close/resolution or timeout | Vote timeout behavior is resolver/scheduler-defined | Death resolution or next night |
| Death resolution | Phân giải người chết | Apply death queue and chain reactions | System/orchestrator | Hunter revenge and role/death effects | Night/vote resolution | Death queue empty and win check complete | Must be idempotent; no duplicate death/event | Next night, game end, or day |
| Game end | Kết thúc ván | Announce result and clean up match state | All room participants, with visibility policy | Read result; room cleanup | Win condition detected or host `/end` | Cleanup complete | Timer/job cleanup required | Room becomes eligible for a new game according to room policy |

## Phase invariants

A player must be alive and in the room to perform a living-player action. A role action is accepted only in the phase where that action is enabled. Duplicate actions must be idempotent or rejected with a stable error. A transition must persist state before emitting dependent notifications where the event contract requires it. Timers and BullMQ jobs must be canceled or marked complete on transition and game end.

## Timeout policy

The exact fallback per action is implementation-defined and must be read from `TimeoutBehavior`, `RoomTimerService`, `NightActionService`, and the scheduler adapter. The canonical content must say “Hết thời gian — bot tự xử lý theo luật của ván” unless a specific fallback is confirmed. It must not promise that an absent action is always a Skip if the resolver uses a different fallback.

## Visibility

Public phase announcements belong in the group. Role instructions, action prompts, action results, and hidden information belong in private messages. Dead-player restrictions and Silent Mage silence are enforced through policy/state gates rather than message text alone.

## Open audit items

The current repository contains multiple state concepts (`GameState`, `NightPhase`, discussion lifecycle, and `currentRound`). A final enum-level audit is required before changing labels in code. If two internal states have different transition semantics, they must retain distinct canonical definitions even if both are presented to players as “Đêm” or “Ngày”.
