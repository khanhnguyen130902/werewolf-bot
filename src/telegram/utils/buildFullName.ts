import { User } from 'telegraf/types';

/**
 * Builds a display name from a Telegram User object.
 * Priority: "FirstName LastName" -> "FirstName" -> "@username" -> fallback
 */
export function buildFullName(user: User, fallback = 'Player'): string {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  if (user.username) return `@${user.username}`;
  return fallback;
}
