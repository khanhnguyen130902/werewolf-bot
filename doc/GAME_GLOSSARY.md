# Werewolf Telegram Bot — Game Glossary

**Status:** Draft canonical glossary, grounded in the current codebase and master prompt. Terms marked **AMBIGUOUS** require a domain decision before changing runtime behavior.

## Canonical terminology

| Concept | Canonical Vietnamese | Code/domain term | Forbidden or legacy alternatives | Classification |
|---|---|---|---|---|
| Game | Ván chơi | `RoomState` / game lifecycle | Trận, trận đấu | CONFIRMED language standard |
| Player | Người chơi | `PlayerState` | User when addressing a player | CONFIRMED language standard |
| Role | Vai trò | `RoleId` | Class, nghề | CONFIRMED language standard |
| Faction | Phe | `Team` | Team in player-facing copy | CONFIRMED language standard |
| Phase | Giai đoạn | `GameState` / `NightPhase` | Stage, step, turn | CONFIRMED language standard |
| Round | Vòng | `currentRound` | Phase when referring to a full cycle | CONFIRMED domain distinction |
| Night | Đêm | `GameState.NIGHT` / night flow | Night phase in user-facing copy | CONFIRMED language standard |
| Day | Ngày | day flow | Day phase in user-facing copy | CONFIRMED language standard |
| Voting | Bỏ phiếu | vote lifecycle | Vote, chọn người | CONFIRMED language standard |
| Vote | Phiếu bầu | `VOTE_CAST` | Chọn người | CONFIRMED language standard |
| Alive | Còn sống | `PlayerState.alive === true` | Đang chơi, chưa bị loại | CONFIRMED language standard |
| Dead | Đã chết | `PlayerState.alive === false` | Bị loại, out, eliminated | CONFIRMED language standard |
| Joined | Đã tham gia | room player membership | Đã vào game | CONFIRMED language standard |
| Left | Đã rời ván | leave lifecycle | Thoát game | CONFIRMED language standard |
| Winner | Phe thắng | `WinnerTeam` | Người thắng when referring to faction | CONFIRMED language standard |
| Game end | Kết thúc ván | `GAME_ENDED` | Kết thúc phòng | CONFIRMED language standard |
| Host | Chủ phòng | room host | Admin unless it is actually admin | CONFIRMED language standard |
| Room | Phòng chơi | room id mapped to Telegram group | Lobby when referring to an active group | CONFIRMED from `/create` design |
| Target | Mục tiêu | action target | Đối tượng | CONFIRMED action vocabulary |
| Skip | Bỏ qua | `SKIP` / nullable target | Không làm gì | CONFIRMED action vocabulary |
| Timeout | Hết thời gian | scheduler timeout | Hết lượt | CONFIRMED timeout vocabulary |
| Public | Công khai | audience visibility | Public | CONFIRMED content policy |
| Private role message | Tin nhắn vai trò riêng | role-private Telegram DM | Secret message | CONFIRMED content policy |

## Canonical role names

| Role ID | Canonical display name | Emoji | Faction |
|---|---|---|---|
| `VILLAGER` | Dân làng | 🧑‍🌾 | Dân |
| `WEREWOLF` | Sói | 🐺 | Sói |
| `HUNTER` | Thợ săn | 🏹 | Dân |
| `SEER` | Tiên tri | 🔮 | Dân |
| `BODYGUARD` | Bảo vệ | 🛡️ | Dân |
| `WITCH` | Phù thủy | 🧙‍♀️ | Dân |
| `SILENT_MAGE` | Pháp sư câm | 🤫 | Dân |

## Canonical phase vocabulary

| Domain concept | User-facing term | Notes |
|---|---|---|
| `WAITING` | Đang chờ người chơi | Lobby exists, game has not started. |
| `STARTING` | Đang bắt đầu ván | Transitional state if exposed to players. |
| `FIRST_NIGHT` | Đêm đầu tiên | Initial night behavior; exact role action availability is code-defined. |
| Night action flow | Đêm | Use “Đêm” in player-facing copy, “Giai đoạn Đêm” in documentation. |
| Discussion flow | Thảo luận ban ngày | Exact state identifier must be confirmed from enum before renaming code. |
| Voting flow | Bỏ phiếu | Use only for vote lifecycle, not generic action selection. |
| `ENDED` / closed flow | Đã kết thúc | Keep distinct from a room merely being closed if both states exist. |

## Canonical action vocabulary

| Action ID | Vietnamese label | Button label | Emoji |
|---|---|---|---|
| `KILL` | Tấn công | 🐺 Tấn công | 🐺 |
| `PROTECT` | Bảo vệ | 🛡️ Bảo vệ | 🛡️ |
| `INVESTIGATE` | Điều tra | 🔮 Điều tra | 🔮 |
| `HEAL` | Cứu |🧙‍♂️Cứu |🧙‍♂️|
| `POISON` | Đầu độc | ☠️ Đầu độc | ☠️ |
| `MUTE` | Làm câm | 🤫 Làm câm | 🤫 |
| `VOTE` | Bỏ phiếu | 🗳️ Bỏ phiếu | 🗳️ |
| `SKIP` | Bỏ qua | ⏭️ Bỏ qua | ⏭️ |

## Classification notes

The master prompt requires a distinction between `Phase`, `Round`, `Turn`, and `Stage`. The code has `currentRound`, `GameState`, and `NightPhase`, but the complete public state vocabulary needs a final enum-level audit before changing any user-facing state text. Until that audit is complete, implementation must not introduce new synonyms.

The codebase contains both technical IDs and player-facing text. Technical IDs remain stable; only the mapped Vietnamese display term should be changed in the content layer.
