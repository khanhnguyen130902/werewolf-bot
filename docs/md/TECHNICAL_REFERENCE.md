# Technical Reference

> **Mục đích:** tra cứu nhanh các command, enum, state, action, dữ liệu Redis, lỗi và endpoint của `werewolf-bot`.  
> **Nguyên tắc:** identifier và behavior trong tài liệu được đối chiếu với source hiện tại; phần không có source/test xác nhận được ghi là **CHƯA XÁC ĐỊNH**.

## 1. Runtime contract

| Thuộc tính | Giá trị hiện tại |
|---|---|
| Runtime | Node.js/CommonJS từ TypeScript |
| Entry point | `src/index.ts` |
| Telegram transport | Telegraf polling |
| Persistence | Redis qua `StoragePort`/`RedisStorageAdapter` |
| Scheduler | BullMQ qua `SchedulerPort` |
| HTTP endpoint | `GET /health` |
| Default port | `BOT_PORT`, sau đó `PORT`, fallback `3001` |
| Web dashboard/login | Không tồn tại trong runtime hiện tại |
| SQL Database/ORM | Không có trong source hiện tại |

## 2. Command reference

### 2.1 Public commands

| Command | Context | Actor/permission | Behavior thành công | Behavior lỗi thường gặp |
|---|---|---|---|---|
| `/start` | Private chat | Bất kỳ user | Đánh dấu DM reachable để bot được phép gửi proactive message. | Gửi ở group sẽ không thay thế private prerequisite. |
| `/create` | Group/supergroup | User chưa có active session | Tạo room OPEN; caller là host. | Room đã active, caller đã có room hoặc storage conflict. |
| `/join` | Group/supergroup | User có DM reachable | Thêm user vào room OPEN. Username Telegram được lưu nếu có. | `DM_NOT_REACHABLE`, `ROOM_FULL`, `ROOM_LOCKED`, duplicate/session conflict. |
| `/leave` | Group/supergroup | Player hiện tại | Rời room và clear session. | Không có room/session hoặc room đã locked theo rule hiện tại. |
| `/startgame` | Group/supergroup | Host | Validate count, assign role, lock room, start first night. | `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `TOO_MANY_PLAYERS`, plan không fit. |
| `/status` | Group/supergroup | Bất kỳ member | In phase, round, số alive/total và timer còn lại. | Không có room hoặc room đã GAME_OVER/CLOSED. |
| `/vote` | Group/supergroup | Player trong match nếu room locked | Từ DAY/DISCUSSION mở VOTING; trong VOTING nhắc ballot hiện tại. | Phase guard nếu gọi ở NIGHT/EXECUTION hoặc state không hợp lệ. |
| `/end` | Group/supergroup | Host | Đóng room, cleanup session/timer/mute state theo flow. | `NOT_HOST`, `ROOM_NOT_FOUND`. |
| `/bottest` | Group/supergroup | QA/developer | Tạo synthetic test room 4–15 player; có thể đặt role override cho host. | Private context, count ngoài range, room đang active. |
| `/help` | Group hoặc private | Bất kỳ user | Trả help text canonical. | Không có behavior đặc biệt ngoài Telegram delivery error. |

### 2.2 `/bottest` syntax

```text
/bottest [playerCount] [roleAlias]
```

`playerCount` mặc định là 6 và source chấp nhận 4 đến 15. Alias được normalize không dấu và không phân biệt hoa thường.

| Role | Alias hiện tại |
|---|---|
| Werewolf | `soi` |
| Seer | `tientri`, `tientriy`, `seer` |
| Bodyguard | `baove`, `bodyguard`, `doctor` |
| Witch | `phuthuy`, `witch` |
| Hunter | `thosan`, `hunter` |
| Silent Mage | `phapsucam`, `silentmage`, `silentwizard` |
| Villager | `danlang`, `villager` |

Ví dụ:

```text
/bottest 8 phapsucam
/startgame
```

`/bottest` tạo các bot giả có ID bắt đầu bằng `999999900`. Đây là utility QA, không phải cách thêm người chơi Telegram thật.

## 3. State and status reference

| Enum | Meaning | Allowed next states |
|---|---|---|
| `WAITING` | Room đang nhận player | `STARTING` |
| `STARTING` | Bookkeeping start flow | `FIRST_NIGHT`, `WAITING` |
| `FIRST_NIGHT` | Đêm đầu tiên | `DAY` |
| `NIGHT` | Đêm của round thường | `DAY` |
| `DAY` | Hand-off sau night | `DISCUSSION`, `VOTING`, `CHECK_WIN` |
| `DISCUSSION` | Discussion opening/active | `VOTING`, `CHECK_WIN` |
| `VOTING` | Ballot hiện tại | `EXECUTION` |
| `EXECUTION` | Tally/death chain | `CHECK_WIN` |
| `CHECK_WIN` | Branch kiểm tra winner | `NIGHT`, `VOTING`, `GAME_OVER` |
| `GAME_OVER` | Terminal | Không có |

`RoomStatus` khác với `GameState`: status mô tả membership/room lifecycle (`OPEN`, `LOCKED`, `CLOSED`), còn gameState mô tả phase của match.

## 4. `PlayerState` reference

| Field | Type | Meaning |
|---|---|---|
| `telegramId` | string | ID ổn định của Telegram user/bot synthetic. |
| `nickname` | string | Tên hiển thị trong message. |
| `username` | string/null | Telegram username tại thời điểm join nếu account cung cấp. |
| `role` | `RoleId/null` | Role được assign sau start. |
| `team` | `Team/null` | Phe tương ứng với role. |
| `alive` | boolean | Có còn trong match hay không. |
| `protected`, `poisoned` | boolean | Per-night effect flags. |
| `voteTarget` | string/null | Target của vote hiện tại; null cũng dùng cho skip. |
| `hasVotedThisRound` | boolean | Vote lock trong round. |
| `isHost` | boolean | Quyền room host. |
| `joinedAt` | number | Join order/timestamp dạng epoch ms. |
| `deathCause` | string/null | Cause khi chết. |
| `diedOnRound` | number/null | Round death. |
| `hunterRevengeTarget` | string/null | Target đã chọn cho Hunter revenge. |
| `silencedUntilRound` | number/null | Round silence active. |
| `silencedDiscussionCycleId` | string/null | Discussion cycle silence active. |

## 5. Roles and actions

| Role ID | Team | Night action | Primary validation |
|---|---|---|---|
| `VILLAGER` | `VILLAGE` | none | Không có night action. |
| `WEREWOLF` | `WEREWOLF` | `WEREWOLF_VOTE_KILL` | Player sống, đúng role; consensus của toàn bộ Sói sống. |
| `SEER` | `VILLAGE` | `SEER_INSPECT` | Target sống, không self; repeat target liên tiếp bị service guard. |
| `BODYGUARD` | `VILLAGE` | `BODYGUARD_PROTECT` | Target sống; self/consecutive theo setting. |
| `HUNTER` | `VILLAGE` | `HUNTER_SHOOT` | Selection/revenge theo DeathQueue và hunter trigger settings. |
| `WITCH` | `VILLAGE` | `WITCH_SAVE`, `WITCH_POISON` | Potion từng loại một lần; save self được, poison self cấm. |
| `SILENT_MAGE` | `VILLAGE` | `SILENT_MAGE_SILENCE` | Target sống, không self, không repeat liên tiếp. |

## 6. Night action lifecycle

```text
callback action
  → recordActionIdIfNew
  → room/player/phase validation
  → role-specific target validation
  → CAS save pendingNightActions
  → append NIGHT_ACTION_SUBMITTED
  → publish event
```

Witch action được tách thành `NightPhase.ACTIONS` và `NightPhase.WITCH`. Các action hợp lệ vẫn có thể bị rejected ở resolution nếu potion đã bị tiêu hao hoặc nhiều submission xung đột.

## 7. Night resolution reference

`NightResolver` xử lý theo `settings.nightActionOrder`. Kết quả gồm depth-0 deaths, pending Hunter IDs, Seer results, potion state, target history và Silent Mage target. Resolution cuối cùng kill player, reset per-night flags, áp silence nếu target vẫn sống và chuyển state.

| Interaction | Behavior hiện tại |
|---|---|
| Werewolf + Bodyguard | Bodyguard protection chặn `WEREWOLF_KILL`. |
| Werewolf + Witch save | Witch save cũng chặn `WEREWOLF_KILL`; potion vẫn consumed. |
| Witch poison + protection | Protection không chặn Witch poison. |
| Seer chết cùng đêm | Seer result được tính trước death finalization và vẫn có thể gửi DM. |
| Hunter chết | DeathQueue có thể tạo prompt revenge theo trigger cause; chain được giới hạn. |
| Silent Mage target chết trong night | Target không nhận silence vì chỉ player alive sau finalization mới active. |
| Wolf không consensus | Không có wolf kill. |

## 8. Day, Silence Gate and voting

Discussion có lifecycle `OPENING` → `ACTIVE` → đóng. Opening announcement phải được gửi trước khi `discussionEnforcementReady` được bật. Các message speech gồm text, voice, sticker, GIF/animation. Command và callback không bị coi là speech event.

Vote callback là flow riêng:

```text
button callback
  → decode action/ballot
  → lookup player session
  → validate phase + ballotId
  → submitVote
  → refresh ballot or resolve execution
```

| Rule | Current behavior |
|---|---|
| Vote target | Player sống hoặc null để skip. |
| Vote duplicate | Bị từ chối sau lần đầu trong round. |
| Stale callback | `STALE_BALLOT`; callback cũ không được ghi vote. |
| Dead player | Không được vote. |
| Silence vs vote | Silence Gate chỉ kiểm tra speech message; không chặn vote callback. |
| `/vote` | Skip DAY/DISCUSSION hoặc nhắc ballot khi VOTING. |

## 9. Redis reference

| Key | Data | Lifecycle |
|---|---|---|
| `room:{roomId}` | Serialized `RoomState` | Tồn tại cho đến khi room delete. |
| `rooms:active` | Set room IDs | Add khi create, remove khi delete. |
| `session:{telegramId}` | Current room ID | Clear khi leave/kick/close. |
| `logs:{matchId}` | Serialized `DomainEvent[]` | Append-only; retention chưa được cấu hình trong adapter. |
| `action-dedup:{roomId}:{actionId}` | `1` | TTL do service truyền, mặc định action 30 phút. |
| `timer:{roomId}` | Absolute deadline epoch ms | Set trước schedule, clear khi phase kết thúc. |
| `dm-reachable:{telegramId}` | `1` | Set sau private `/start`; không có TTL trong adapter. |

`saveRoom(room, expectedVersion)` tăng version và dùng Lua CAS. Khi version mismatch, adapter ném `CONCURRENT_MODIFICATION`.

## 10. Configuration contract

```env
TELEGRAM_BOT_TOKEN=<secret>
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
NODE_ENV=development
BOT_PORT=3001
MUTE_DEAD_PLAYERS=true
```

`PORT` có thể được provider inject và được dùng khi `BOT_PORT` không có. Không commit token hoặc password. Dashboard variables, JWT, SQL connection string và web login không thuộc current runtime.

## 11. HTTP contract

### `GET /health`

Response status `200`:

```json
{"status":"ok"}
```

Endpoint này kiểm tra HTTP process, không tự chứng minh Telegram polling hoặc Redis worker đã healthy. Cần đối chiếu thêm startup log và Redis connectivity.

### Fallback

Mọi path khác trả `200 text/plain` với:

```text
Werewolf bot is running
```

Đây không phải web UI hoặc authentication endpoint.

## 12. Error code reference

| Code | User-facing meaning | Operator action |
|---|---|---|
| `ROOM_NOT_FOUND` | Không tìm thấy room | Kiểm tra room ID/Redis. |
| `ROOM_FULL` | Room đủ người | Dùng room khác hoặc chờ ván kết thúc. |
| `ROOM_LOCKED` | Ván đã bắt đầu | Không join giữa match. |
| `PLAYER_ALREADY_IN_ROOM` | User đã có session | Kiểm tra room hiện tại hoặc leave. |
| `PLAYER_NOT_IN_ROOM` | User không thuộc room | Join đúng room trước. |
| `NOT_ENOUGH_PLAYERS` | Chưa đủ player | Thêm player trước `/startgame`. |
| `TOO_MANY_PLAYERS` | Vượt giới hạn | Giảm player hoặc sửa settings hợp lệ. |
| `NOT_HOST` | Không có host permission | Host thực hiện command. |
| `DEAD_PLAYER_ACTION` | Player đã chết | Không action/vote nữa. |
| `INVALID_PHASE_ACTION` | Sai phase | Kiểm tra `/status` và timer. |
| `INVALID_TARGET` | Target không hợp lệ | Chọn player còn sống hợp lệ. |
| `WRONG_ROLE_FOR_ACTION` | Sai role | Không tin callback data nếu service từ chối. |
| `NO_POTION_LEFT` | Potion đã hết | Witch không thể dùng lại loại potion đó. |
| `CONCURRENT_MODIFICATION` | Có update đồng thời | Service retry; kiểm tra Redis nếu lặp lại. |
| `DUPLICATE_ACTION` | Action/vote đã xử lý | Không submit lại callback cũ. |
| `STALE_RESOLUTION` | Snapshot resolution cũ | Chờ flow hiện tại; điều tra timer race nếu bất thường. |
| `STALE_BALLOT` | Nút vote thuộc ballot cũ | Mở ballot mới bằng `/vote`. |
| `INVALID_STATE_TRANSITION` | Phase transition bất hợp lệ | Trace state/timer, không sửa Redis thủ công. |
| `DM_NOT_REACHABLE` | Chưa mở DM bot | Gửi `/start` trong private chat. |

## References

[1]: ../../src/engine/domain/enums.ts "Enums"
[2]: ../../src/engine/domain/Room.ts "RoomState và settings"
[3]: ../../src/engine/domain/Player.ts "PlayerState"
[4]: ../../src/engine/NightActionService.ts "Night action contract"
[5]: ../../src/engine/DayService.ts "Day and voting contract"
[6]: ../../src/engine/night/NightResolver.ts "Night resolution"
[7]: ../../src/infrastructure/redis/RedisStorageAdapter.ts "Redis adapter"
[8]: ../../src/engine/errors/DomainError.ts "Error taxonomy"
