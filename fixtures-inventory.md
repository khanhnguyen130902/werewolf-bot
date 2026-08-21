# Reusable Fixtures and Test Data Inventory

## Existing reusable foundations

| Fixture/helper | Location | Reuse value | Notes |
|---|---|---|---|
| `RoomFactory.create` | `src/engine/domain/Room.ts` | High | Creates a normalized WAITING room, merges settings overrides, clamps supported player limits, and initializes version, actions, timers, ballot and discussion fields. |
| `PlayerFactory.create` | `src/engine/domain/Player.ts` | High | Creates normalized player state with explicit Telegram ID, role/team and timestamps. |
| In-memory storage adapter | `src/infrastructure/redis/InMemoryStorageAdapter.ts` | High | Deterministic storage double with session-claim NX semantics and versioned room writes. |
| Test bot transport/context stubs | distributed in `tests/telegram/*.test.ts` | Medium | Useful for command/callback tests but currently recreated per suite. |
| Local `fixture()` functions | `BotPolicySilence.test.ts`, Silent Mage tests and service suites | Medium | Readable and targeted, but not shared across suites. |
| Seeded/random helpers | `RandomizedGameInvariant.test.ts`, `RoleDistributionProperty.test.ts` | Medium | Provide reproducible randomized coverage; seed reporting should remain mandatory for failures. |
| Stress-room conventions | `BottestStress100.e2e.test.ts`, `SilentMageE2E200.e2e.test.ts` | Medium | Unique room IDs isolate runs; they are scenario-specific rather than generic fixtures. |

## Data-quality assessment

The strongest practice is that most tests construct state through `RoomFactory` and `PlayerFactory` instead of manually assembling incomplete `RoomState` objects. This reduces false positives caused by missing newly introduced fields such as `ballotId`, `discussionLifecycle`, `discussionEnforcementReady`, or silence metadata. Storage doubles also preserve the same version and session-claim contracts used by application services.

The main reuse gap is the absence of a centralized `tests/helpers` module for common multi-player rooms, service graphs, fake Telegram contexts, deterministic scheduler ports, and role-specific fixtures. Several suites contain near-duplicate setup for six-player games and bot contexts. This does not currently reduce correctness because all suites pass, but it increases future maintenance cost when the room schema or service constructor changes.

## Recommendations

A future low-risk refactor may add `tests/helpers/roomFixtures.ts` with helpers such as `makeRoom`, `addPlayers`, `makeSixPlayerRoleMatrix`, and `makeServiceGraph`, plus `tests/helpers/telegramFixtures.ts` for callback/command contexts. These helpers should delegate to the production factories, expose explicit overrides, and avoid hiding the state that is important to each test. They should be introduced only with snapshot-equivalence tests or a migration of two representative suites, because overly implicit fixtures can make role and race tests less auditable.

No fixture refactor was required for this audit. The current foundations are reusable enough for the existing 49-suite regression set, and introducing a broad helper layer would be architectural/test-scope churn without a demonstrated defect.
