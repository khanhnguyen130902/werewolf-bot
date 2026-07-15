import 'dotenv/config';

/**
 * Centralized environment/config loading. Every environment variable the
 * bot needs is read exactly once, here, and validated at startup -- so a
 * missing/misconfigured variable fails fast with a clear error instead of
 * causing a confusing runtime crash deep inside some handler later.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
