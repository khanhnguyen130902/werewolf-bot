# Werewolf Telegram Bot — Canonical Rule, Content & Terminology Audit

## Executive status

This consolidation has established a canonical vocabulary and documentation baseline, while preserving the current game mechanics where evidence is available. The audit distinguishes confirmed rules from inferred behavior, conflicts, ambiguities, content mismatches, and implementation bugs. No new role or game mechanic is invented.

## Discovery map

The repository is a TypeScript Telegram bot with the following layers:

| Layer | Current locations | Responsibility |
|---|---|---|
| Configuration | `src/config`, `.env`, `.env.example` | Environment loading and validation |
| Domain | `src/engine/domain`, `src/engine/errors`, `src/engine/ports` | Enums, Room, Player, ports, errors |
| Engine services | `src/engine/RoomService.ts`, `GameService.ts`, `NightActionService.ts`, `DayService.ts` | Lobby, role assignment, actions, day/vote behavior |
| Orchestration | `GameOrchestrator.ts`, `GameStateMachine.ts`, `RoomTimerService.ts` | State transitions, timers, scheduler coordination |
| Resolution | `src/engine/night/DeathQueue.ts`, `NightResolver.ts` | Night effects, death queue, chain reactions |
| Roles | `src/engine/roles` | Seven role definitions and registry |
| Distribution | `src/engine/role-distribution` | Count plan plus randomized assignment |
| Telegram | `src/telegram/commands`, `handlers`, `presenters`, `GameFlowController.ts`, `BotPolicy.ts` | Commands, callbacks, keyboards, messages, visibility gates |
| Infrastructure | `src/infrastructure/redis` | In-memory/Redis persistence and BullMQ integration |
| Tests | `tests/engine`, `tests/telegram`, `tests/infrastructure` | Unit, acceptance, integration, concurrency, content/security regression |

## Seven-role scope

The implemented role IDs are `VILLAGER`, `WEREWOLF`, `HUNTER`, `SEER`, `BODYGUARD`, `WITCH`, and `SILENT_MAGE`. Silent Mage is registered and has a dedicated role/action path. Default distribution does not auto-enable it; explicit configuration at eight or more players activates the expected full preset.

## Canonical mapping chain

```text
RoleId / GameState / NightActionType
        ↓
Role registry + validators + state machine
        ↓
NightActionService / DayService / VoteResolver / DeathQueue
        ↓
Domain events and scheduler jobs
        ↓
Telegram controller + BotPolicy + keyboards
        ↓
Canonical content catalog and Vietnamese player-facing messages
        ↓
Content/security/regression/E2E tests
```

## Findings

| ID | Type | Severity | Current evidence | Canonical resolution |
|---|---|---:|---|---|
| `F-001` | CONFLICT | High | Master prompt scope says max 15; current default settings say max 20. | Preserve current code until domain owner decides; document mismatch and add a capacity decision test. |
| `F-002` | IMPLEMENTATION BUG | High, fixed | `/join` could check DM reachability before checking room existence. | Room-not-found takes precedence; tests cover 100 repeated handler calls and service precedence. |
| `F-003` | CONTENT BUG | Medium, fixed | `/help` was a flat/encoded list and omitted a production information hierarchy. | Replaced with mobile-first Vietnamese onboarding and command categories. |
| `F-004` | CONTENT/SECURITY RISK | High | Role/private content is spread across presenters/controllers and must be audited against BotPolicy. | Use audience metadata and content regression tests; do not expose hidden role/action results. |
| `F-005` | RULE/CONTENT | Medium | Silent Mage had a role implementation but was absent from default auto-special list. | Keep opt-in; explicit Silent Mage at 8+ uses 2W + Seer + Bodyguard + Hunter + Witch + Silent Mage + Villager. |
| `F-006` | AMBIGUOUS | Medium | Exact end-game role reveal policy is not yet fully extracted into one canonical source. | Require domain decision/evidence before rewriting end-game text. |
| `F-007` | AMBIGUOUS | Medium | Tie/no-majority behavior must be confirmed from resolver tests before documentation is final. | Keep catalog neutral; add targeted rule tests. |
| `F-008` | CONTENT ARCHITECTURE | Medium | Message literals are centralized partly in `presenters/messages.ts` but still exist in command/controller paths. | Introduce a typed canonical content catalog incrementally, starting with stable IDs and audience metadata. |

## Completed consolidation artifacts

- `GAME_RULES.md`
- `ROLE_SPECIFICATIONS.md`
- `PHASE_SPECIFICATIONS.md`
- `ACTION_SPECIFICATIONS.md`
- `MESSAGE_CATALOG.md`
- `GAME_GLOSSARY.md`
- `CONTENT_GUIDELINES.md`

## Remaining implementation work

The next implementation step is to install these documents into the repository, add typed canonical content metadata for messages/buttons/events, migrate the highest-risk player-facing strings, and add content regression checks for canonical role names, message IDs, audience visibility, button actions, and orphan/duplicate keys. This must be done without silently resolving the max-player, tie, or end-game reveal conflicts.
