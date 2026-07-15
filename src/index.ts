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
import { registerActionCallbackHandler } from './telegram/handlers/actionCallbackHandler';
import { GameState } from './engine/domain/enums';

async function main(): Promise<void> {
  logger.info('Starting Werewolf Telegram Bot...');

  const services = new BotServices(config.redisUrl);
  const bot = new Telegraf<BotContext>(config.telegramBotToken);
  const flowController = new GameFlowController(services, bot);

  // --- Register commands ---
  registerStartCommand(services, bot);
  registerCreateCommand(services, bot);
  registerJoinCommand(services, bot);
  registerLeaveCommand(services, bot);
  registerStartGameCommand(services, flowController, bot);
  registerStatusCommand(services, bot);
  registerVoteCommand(services, flowController, bot);
  registerEndCommand(services, bot);

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
    const overdueRoomIds = await services.timerService.findOverdueRooms(activeRoomIds);
    for (const roomId of overdueRoomIds) {
      const room = await services.roomService.getRoom(roomId);
      if (!room) continue;
      logger.info(`Resuming overdue room ${roomId} in state ${room.gameState}`);

      if (room.gameState === GameState.NIGHT || room.gameState === GameState.FIRST_NIGHT) {
        const {
          room: resolvedRoom,
          deaths,
          seerResults,
        } = await services.orchestrator.resolveNight({
          roomId,
          promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
        });
        await flowController.onNightResolved(resolvedRoom, deaths, seerResults);
      } else if (room.gameState === GameState.DISCUSSION) {
        await flowController.startVoting(roomId);
      } else if (room.gameState === GameState.VOTING) {
        const {
          room: resolvedRoom,
          executedTelegramId,
          deaths,
        } = await services.orchestrator.resolveExecution({
          roomId,
          promptHunter: (rid, hid) => flowController.promptHunterAndAwait(rid, hid),
        });
        await flowController.onExecutionResolved(resolvedRoom, executedTelegramId, deaths);
      }
    }
  } catch (err) {
    logger.error('Error while resuming overdue rooms on startup', { err });
  }

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    bot.stop(signal);
    await services.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await bot.launch();
  logger.info('Bot is up and running.');
}

main().catch((err) => {
  logger.error('Fatal error during bot startup', { err });
  process.exit(1);
});
