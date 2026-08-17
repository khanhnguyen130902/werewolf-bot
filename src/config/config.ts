import 'dotenv/config';

/**
 * Centralized environment/config loading. Secrets are read once and are never
 * included in validation errors or log metadata.
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(): number {
  const raw = process.env.PORT?.trim() ?? '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseLogLevel(): string {
  const level = process.env.LOG_LEVEL?.trim() ?? 'info';
  const allowed = new Set(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']);
  if (!allowed.has(level)) {
    throw new Error(`LOG_LEVEL must be one of: ${[...allowed].join(', ')}`);
  }
  return level;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`${name} must be either true or false`);
  }
  return raw === 'true';
}

const nodeEnv = process.env.NODE_ENV?.trim() ?? 'development';
const redisUrl = process.env.REDIS_URL?.trim();
if (!redisUrl) {
  if (nodeEnv === 'production') {
    throw new Error('Missing required environment variable in production: REDIS_URL');
  }
  throw new Error('Missing required environment variable: REDIS_URL');
}

if (!/^rediss?:\/\//i.test(redisUrl)) {
  throw new Error('REDIS_URL must use redis:// or rediss://');
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  redisUrl,
  logLevel: parseLogLevel(),
  nodeEnv,
  httpPort: parsePort(),
  muteDeadPlayers: parseBoolean('MUTE_DEAD_PLAYERS', true),
};
