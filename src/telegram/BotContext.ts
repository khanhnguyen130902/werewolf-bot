import { Context } from 'telegraf';

/**
 * The bot only uses the base Telegraf Context -- no custom session
 * properties are attached to `ctx` itself. All game state lookups go
 * through GameOrchestrator/StoragePort (keyed by Telegram chat id / user
 * id), so the "session" is really just "which room is this chat/user
 * currently in", which is looked up on demand rather than cached on the
 * context object. This keeps the bot naturally horizontally-scalable (no
 * in-process session affinity needed) and consistent with storing all state
 * in Redis.
 */
export type BotContext = Context;
