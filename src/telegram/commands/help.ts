import { Telegraf } from 'telegraf';
import { BotContext } from '../BotContext';
import { BotServices } from '../BotServices';
import { CANONICAL_HELP_TEXT } from '../presenters/canonicalContent';

/**
 * `/help` is a thin transport adapter. Player-facing onboarding copy lives in
 * the typed canonical content layer so terminology and command guidance have a
 * single source of truth.
 */
export const HELP_TEXT = CANONICAL_HELP_TEXT;

export function registerHelpCommand(_services: BotServices, bot: Telegraf<BotContext>): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
