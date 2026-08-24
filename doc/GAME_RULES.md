# Werewolf Telegram Bot — Canonical Game Rules

**Status:** Consolidation baseline. This document is a rule source of truth only after each item is reconciled with executable code and tests. Items marked `CONFLICT` or `AMBIGUOUS` must not be silently changed.

## 1. Objective

A complete ván chơi assigns each participant one hidden vai trò. The game proceeds through lobby, role assignment, night/day/voting and resolution cycles until a win condition is detected or the host/system ends the room. The player-facing language is Vietnamese; domain IDs remain stable technical identifiers.

## 2. Player limits

The master prompt declares a target scope of **3–15 players**. The current repository default in `DEFAULT_GAME_SETTINGS` has `minPlayers = 3` and `maxPlayers = 20`.

> **CONFLICT — PLAYER CAPACITY:** The requested canonical scope says 15, while current code says 20. The current task must not silently change the capacity because the master prompt explicitly forbids changing player capacity without evidence. A domain decision is required: retain 20 for backward compatibility or change to 15 with migration/tests.

Confirmed behavior: fewer than the configured minimum cannot start. More than the configured maximum cannot join.

## 3. Lobby

`/create` creates a room mapped one-to-one to the Telegram group. The host is the user who creates the room. `/join` adds a player to the current open room. `/leave` removes a player according to room lifecycle rules. `/status` reports safe public room state. Duplicate join, duplicate leave, late join, and host permissions are validated by `RoomService`.

When `/join` is used before a room exists, the canonical public response is:

> ⚠️ Không tìm thấy phòng chơi này. Có thể phòng đã bị đóng.

DM reachability must not mask this missing-room result. DM prerequisite messaging is only returned after a room exists.

## 4. Game start

The host starts the game using `/startgame` when the minimum player condition is met. The engine computes a role distribution plan, validates that the plan total equals the player count, shuffles players and roles independently, persists assignments, and delivers role information privately. A role is never selected for a player by deterministic position.

The default role plan is player-count dependent. Silent Mage is automatically included in every game with 8–15 players, regardless of whether `enabledRoles` is empty or contains another explicit role list. The expected eight-player preset is:

```text
2 Werewolf
1 Seer
1 Bodyguard
1 Hunter
1 Witch
1 Silent Mage
1 Villager
```

For 9–15 players, the same five special roles remain present; the number of Werewolves follows the existing player-count formula and remaining slots are filled by Dân làng. Role assignment remains randomized.

## 5. Night

At night, living players with a night capability receive private prompts. The current action vocabulary includes wolf attack, Bodyguard protection, Seer investigation, Witch save, Witch poison, Silent Mage silence, Hunter revenge on a permitted death trigger, and Skip where the action contract permits it. Target validity, actor eligibility, current phase, duplicate action, potion inventory, consecutive-target restrictions, and dead-player status are enforced by services/resolvers.

The Silent Mage may not silence the same player on two consecutive nights. The previous silence target is persisted per match and checked when the next Silent Mage action is submitted. A different living target or Skip remains subject to the existing phase, role, and target rules.

Night actions are collected and resolved through the orchestration/timer/scheduler path. On timeout, the configured fallback is applied. The exact fallback must be read from the current timeout policy rather than promised in generic content.

## 6. Day and discussion

After night resolution, the bot announces safe public results and opens discussion according to the current state machine. Living-player restrictions and Silent Mage silence are enforced by `DayService` and `BotPolicy`, not by message text alone. Dead players must not use living-player actions or influence voting unless an explicit future rule says otherwise.

## 7. Voting

Eligible living players vote during the voting phase. Votes are validated against current phase, actor status, target status, ballot state, and vote policy. The resolver determines vote close, tie, no-majority, timeout, and execution outcomes. The exact tie/no-majority rule is an audit item unless directly confirmed by resolver tests.

## 8. Death and chain reactions

Deaths are queued and resolved through the death queue. Protection, save, poison, wolf attack, vote execution, and Hunter revenge may contribute to the queue. Chain reactions are processed idempotently. Public death announcements must not reveal hidden roles unless the canonical end-game rule allows it.

## 9. Win conditions

The system emits `WIN_CONDITION_MET` and `GAME_ENDED` events. Village and Wolf winners are represented by the domain winner model. The exact simultaneous-condition priority and end-game role reveal policy must be documented from the current `GameService`/orchestrator tests before any content claims are treated as final.

## 10. End game

At game end, the result is announced to the appropriate audience, timers and scheduled jobs are cleaned up, room state is persisted, and the room becomes eligible for a new game according to current room lifecycle rules. `/end` remains a host/system operation and must not be described as an ordinary player action.

## 11. Safety invariants

A hidden role must not leak through public content. A player cannot act while dead. A callback cannot bypass role/phase/room validation. A duplicate callback must not duplicate a death, vote, potion use, silence, or event. A stale scheduler job must not mutate a newer match. Every state transition must be observable through stable domain events and safe logs.

## 12. Rule classifications

| ID | Classification | Finding | Required action |
|---|---|---|---|
| `RULE-001` | CONFLICT | Master prompt says max 15; code default says max 20. | Domain decision required; do not silently change. |
| `RULE-002` | CONFIRMED | Minimum default is 3. | Keep tests and help aligned. |
| `RULE-003` | CONFIRMED | Silent Mage is explicit at 8+ for the expected preset. | Keep `SilentMageDistribution.test.ts` as guard. |
| `RULE-004` | IMPLEMENTATION BUG fixed | `/join` could report DM error before missing-room error. | Room existence now has precedence; regression tests cover it. |
| `RULE-005` | AMBIGUOUS | Exact public role reveal at game end. | Decide before finalizing end-game copy. |
| `RULE-006` | CONFIRMED | Silent Mage cannot silence the same player on two consecutive nights; previous target is persisted per match. | Enforced in `NightActionService`; covered by regression tests. |
| `RULE-007` | AMBIGUOUS | Exact tie/no-majority player-facing rule. | Confirm from resolver/tests before documenting as final. |
