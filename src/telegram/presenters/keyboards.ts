import { Markup } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

export interface TargetOption {
  telegramId: string;
  nickname: string;
}

/**
 * Builds an inline keyboard where each button targets one player, encoding
 * the action type and target directly in the callback_data string (format:
 * "action:<actionType>:<targetTelegramId>"). Telegram limits callback_data
 * to 64 bytes, so telegramIds (which are just numeric Telegram user ids as
 * strings) comfortably fit alongside a short actionType tag.
 *
 * A trailing "Bỏ qua" (skip/abstain) button is included by default since
 * most actions (Werewolf kill, Seer inspect, Bodyguard protect, Witch
 * potions, votes) all support an explicit null/skip choice per the engine's
 * confirmed business rules (blank votes allowed, potions optional, etc).
 */
export function buildTargetKeyboard(params: {
  actionType: string;
  targets: TargetOption[];
  includeSkip?: boolean;
}): Markup.Markup<InlineKeyboardMarkup> {
  const rows = params.targets.map((t) => [
    Markup.button.callback(t.nickname, `action:${params.actionType}:${t.telegramId}`),
  ]);
  if (params.includeSkip ?? true) {
    rows.push([Markup.button.callback('⏭ Bỏ qua', `action:${params.actionType}:SKIP`)]);
  }
  return Markup.inlineKeyboard(rows);
}

/** Parses a callback_data string produced by buildTargetKeyboard back into
 * its actionType and targetTelegramId (null for the skip button). Returns
 * null if the string doesn't match the expected "action:..." format, so
 * callers can safely ignore callback queries from unrelated buttons/bots. */
export function parseActionCallbackData(
  data: string,
): { actionType: string; targetTelegramId: string | null } | null {
  const parts = data.split(':');
  if (parts.length !== 3 || parts[0] !== 'action') {
    return null;
  }
  const [, actionType, target] = parts;
  return { actionType, targetTelegramId: target === 'SKIP' ? null : target };
}
