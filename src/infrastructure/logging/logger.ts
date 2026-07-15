import winston from 'winston';
import { config } from '../../config/config';

/**
 * Application-wide structured logger. Kept in infrastructure (not engine)
 * since logging destination/format is an operational concern, not a game
 * rule -- the engine only ever emits DomainEvents via EventBus; this logger
 * is one of several possible EventBus subscribers (see EventBus).
 */
export const logger = winston.createLogger({
  level: config.logLevel,
  format:
    config.nodeEnv === 'production'
      ? winston.format.combine(winston.format.timestamp(), winston.format.json())
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} ${level}: ${message} ${metaStr}`;
          }),
        ),
  transports: [new winston.transports.Console()],
});
