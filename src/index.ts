import { createServer } from 'http';
import { Telegraf } from 'telegraf';
import { config } from './config/config';
import { logger } from './infrastructure/logging/logger';
import { BotServices } from './telegram/BotServices';
import { GameFlowController } from './telegram/GameFlowController';
import { BotContext } from './telegram/BotContext';
import { registerStartCommand } from './telegram/commands/start';
import { registerCreateCommand } from './telegram/commands/create';
import { registerJoinCommand } from './telegram/commands/join';
import { registerLeaveCommand } from './telegram/commands/leave';
import { registerStartGameCommand } from './telegram/commands/startgame';
import { registerStatusCommand } from './telegram/commands/status';
import { registerVoteCommand } from './telegram/commands/vote';
import { registerEndCommand } from './telegram/commands/end';
import { registerbottestCommand } from './telegram/commands/bottest';
import { registerHelpCommand } from './telegram/commands/help';
import { registerActionCallbackHandler } from './telegram/handlers/actionCallbackHandler';
import { GameState, NightPhase } from './engine/domain/enums';

const RETRYABLE_STARTUP_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
]);

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const value = (err as { code?: unknown }).code;
  return typeof value === 'string' ? value : undefined;
}

function startupRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * (2 ** Math.min(attempt - 1, 4)));
}

async function launchWithTransientRetry(bot: Telegraf<BotContext>): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      await bot.launch();
      logger.info('Bot is up and running.');
      return;
    } catch (err) {
      const code = errorCode(err);
      if (!code || !RETRYABLE_STARTUP_CODES.has(code)) throw err;
      attempt += 1;
      const delayMs = startupRetryDelayMs(attempt);
      logger.warn('Telegram startup request failed transiently; retrying', {
        attempt,
        code,
        retryInMs: delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main(): Promise<void> {
  logger.info('Starting Werewolf Telegram Bot...');

  const services = new BotServices(config.redisUrl);
  await services.initialize();
  const bot = new Telegraf<BotContext>(config.telegramBotToken);
  const flowController = new GameFlowController(services, bot);

  // Never let an update-level failure disappear without a structured log.
  // This is especially important for polling/debug sessions where a command
  // can otherwise look like it received no response.
  bot.catch((err, ctx) => {
    logger.error('Unhandled Telegram update error', {
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      fromId: ctx.from?.id,
      err,
    });
  });

  // --- Register middleware to delete messages from muted/dead players ---
  bot.use(async (ctx, next) => {
    if (
      ctx.chat &&
      (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') &&
      ctx.message &&
      ctx.from
    ) {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const isEndCommand =
        text.startsWith('/end') && (text.length === 4 || text[4] === ' ' || text[4] === '@');

      if (!isEndCommand) {
        const chatId = ctx.chat.id;
        const userId = String(ctx.from.id);
        let isMuted = false;
        try {
          isMuted = await flowController.muteService.isPlayerMuted(chatId, userId);
        } catch (err) {
          // Redis availability must not make every command appear unresponsive.
          // Continue the update and let the command handler return its own result.
          logger.error('Mute middleware Redis check failed; continuing update', {
            chatId,
            userId,
            err,
          });
        }
        if (isMuted) {
          try {
            await ctx.deleteMessage();
          } catch (err) {
            logger.warn(`Failed to delete message from muted user ${userId} in chat ${chatId}`, { err });
          }
          return; // Stop propagation
        }

        const message = ctx.message;
        const isCommand = 'text' in message && message.text.startsWith('/');
        const messageKind = 'text' in message
          ? 'TEXT'
          : 'voice' in message
            ? 'VOICE'
            : 'sticker' in message
              ? 'STICKER'
              : 'animation' in message
                ? 'GIF'
                : null;

        if (!isCommand && messageKind) {
          try {
            const activeRoom = await services.roomService.findActiveRoomByChatId(String(chatId));
            if (
              activeRoom
              && activeRoom.gameState === GameState.DISCUSSION
              && activeRoom.discussionLifecycle === 'ACTIVE'
              && activeRoom.discussionEnforcementReady === true
            ) {
              const result = await services.dayService.resolveDiscussionSpeechViolation({
                roomId: activeRoom.id,
                speechEventId: `speech-${ctx.update.update_id}`,
                speakerTelegramId: userId,
                chatId: String(chatId),
                messageKind,
                hunterPrompt: (hunterId) => flowController.promptHunterAndAwait(activeRoom.id, hunterId),
              });
              if (result.accepted) {
                try {
                  await ctx.deleteMessage();
                } catch (err) {
                  logger.warn(`Failed to delete speech-violation message from ${userId} in chat ${chatId}`, { err });
                }
                await flowController.onDiscussionDeathResolved(result.room, result.deaths);
                return;
              }
            }
          } catch (err) {
            logger.error('Silence Gate processing failed; continuing update', {
              chatId,
              userId,
              updateId: ctx.update.update_id,
              err,
            });
          }
        }
      }
    }
    return next();
  });

  // --- Register commands ---
  registerStartCommand(services, bot);
  registerCreateCommand(services, flowController, bot);
  registerJoinCommand(services, bot);
  registerLeaveCommand(services, bot);
  registerStartGameCommand(services, flowController, bot);
  registerStatusCommand(services, bot);
  registerVoteCommand(services, flowController, bot);
  registerEndCommand(services, flowController, bot);
  registerbottestCommand(services, bot);
  registerHelpCommand(services, bot);

  // --- Register callback query handlers ---
  // Order matters: the Hunter-revenge handler (registered inside
  // GameFlowController's constructor) checks for "hunter-shot:" prefixed
  // data and calls next() for anything else, letting this handler process
  // "action:" prefixed data for regular night actions and votes.
  registerActionCallbackHandler(services, flowController, bot);

  // --- Register BullMQ timeout handlers for the three timed phases ---
  flowController.registerTimeoutHandlers();

  // --- Suggestion #6: resume rooms whose timer already elapsed while this
  // process was down (e.g. Render restarted mid-night). BullMQ itself will
  // still redeliver each room's originally-scheduled job on its own, but
  // this proactively resolves anything already overdue right now instead of
  // waiting on Worker polling to catch up. ---
  try {
    const activeRoomIds = await services.storage.listActiveRoomIds();
    // Recover a timer that may have been cleared by an invalid command or
    // lost during a process restart before the transition committed. The
    // controller no-ops when a valid deadline already exists, so this cannot
    // create duplicate timers during normal startup.
    for (const roomId of activeRoomIds) {
      const activeRoom = await services.roomService.getRoom(roomId);
      // DAY is an intermediate hand-off state. It normally exists only while
      // onNightResolved is announcing the day and opening discussion. If the
      // process restarts in that window, there is no DAY timer to re-arm, so
      // recover the transition explicitly instead of leaving the room stuck.
      if (activeRoom?.gameState === GameState.DAY) {
        logger.warn(`Recovering transient DAY room ${roomId} into DISCUSSION`);
        await flowController.startDiscussion(roomId);
        continue;
      }
      await flowController.ensurePhaseTimer(roomId);
    }
    const overdueRoomIds = await services.timerService.findOverdueRooms(activeRoomIds);
    for (const roomId of overdueRoomIds) {
      const room = await services.roomService.getRoom(roomId);
      if (!room) continue;
      logger.info(`Resuming overdue room ${roomId} in state ${room.gameState}`);

      if (room.gameState === GameState.NIGHT || room.gameState === GameState.FIRST_NIGHT) {
        if (room.nightPhase !== NightPhase.WITCH) {
          await flowController.beginWitchPhase(roomId);
        } else {
          await flowController.resolveNight(roomId);
        }
      } else if (room.gameState === GameState.DISCUSSION) {
        if (room.discussionLifecycle === 'ACTIVE' && room.discussionEnforcementReady === true) {
          await flowController.startVoting(roomId);
        } else {
          await flowController.resumeDiscussionOpening(roomId);
        }
      } else if (room.gameState === GameState.VOTING) {
        await flowController.resolveExecution(roomId);
      } else if (room.gameState === GameState.DAY) {
        // Defensive fallback for a room that became DAY after the first
        // recovery scan but still has an overdue persisted deadline.
        await flowController.startDiscussion(roomId);
      }
    }
  } catch (err) {
    logger.error('Error while resuming overdue rooms on startup', { err });
  }

  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Werewolf bot is running');
  });

  httpServer.listen(config.httpPort, () => {
    logger.info(`HTTP server listening on port ${config.httpPort}`);
  });

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    httpServer.close();
    bot.stop(signal);
    await services.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await launchWithTransientRetry(bot);
}

main().catch((err) => {
  logger.error('Fatal error during bot startup', { err });
  process.exit(1);
});
