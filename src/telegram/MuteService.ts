import { Telegraf } from 'telegraf';
import { Redis } from 'ioredis';
import { BotContext } from './BotContext';
import { logger } from '../infrastructure/logging/logger';
import { config } from '../config/config';

function errorMessage(err: unknown): string { return err instanceof Error ? err.message : String(err); }

const TEST_BOT_ID_PREFIX = '999999900';

function isTestBot(telegramId: string): boolean {
  return telegramId.startsWith(TEST_BOT_ID_PREFIX);
}

/**
 * Service to handle muting (restricting message sending) and unmuting
 * players in group chats. All operations are designed to be safe and
 * fail gracefully instead of crashing the bot.
 */
export class MuteService {
  constructor(
    private readonly bot: Telegraf<BotContext>,
    private readonly redis: Redis,
  ) {}

  /**
   * Generates the Redis key used to store the set of muted player IDs for a chat.
   */
  private getMutedPlayersKey(chatId: string | number): string {
    return `muted-players:${chatId}`;
  }

  /**
   * Restricts a single player in a chat, preventing them from sending messages,
   * media, polls, or web page previews.
   */
  async mutePlayer(chatId: string | number, telegramId: string): Promise<void> {
    if (!config.muteDeadPlayers) {
      logger.debug(`MuteDeadPlayers is disabled by config. Skipping mute for user ${telegramId} in chat ${chatId}.`);
      return;
    }

    if (isTestBot(telegramId)) {
      logger.debug(`Skipping mute for test bot ${telegramId} in chat ${chatId}.`);
      return;
    }

    const userId = Number(telegramId);
    if (isNaN(userId)) {
      logger.warn(`Skipping mute: telegramId "${telegramId}" is not a valid number in chat ${chatId}.`);
      return;
    }

    try {
      // 1. Luôn thêm người chơi vào Redis trước như một giải pháp dự phòng cho việc xóa tin nhắn (middleware)
      const key = this.getMutedPlayersKey(chatId);
      await this.redis.sadd(key, telegramId);

      // 2. Xác minh loại chat là supergroup để dùng restrictChatMember
      const chat = await this.bot.telegram.getChat(chatId);
      if (chat.type !== 'supergroup') {
        logger.info(
          `Chat ${chatId} is not a supergroup (type: ${chat.type}). API restriction not supported, relying on message deletion.`,
        );
        return;
      }

      // 3. Xác minh quyền admin của bot để hạn chế thành viên
      const botInfo = this.bot.botInfo || (await this.bot.telegram.getMe());
      const chatMember = await this.bot.telegram.getChatMember(chatId, botInfo.id);

      const isCreator = chatMember.status === 'creator';
      const isAdmin = chatMember.status === 'administrator';
      const hasRestrictPermission =
        isCreator || (isAdmin && (chatMember as unknown as { can_restrict_members?: boolean }).can_restrict_members === true);

      if (!hasRestrictPermission) {
        logger.warn(
          `Cannot restrict user ${telegramId} in chat ${chatId}: Bot lacks "can_restrict_members" permission. Relying on message deletion.`,
        );
        return;
      }

      // 4. Kiểm tra xem người bị tắt tiếng có phải Admin/Creator của nhóm không
      const targetMember = await this.bot.telegram.getChatMember(chatId, userId);
      const cannotRestrict = targetMember.status === 'creator' || targetMember.status === 'administrator';

      if (cannotRestrict) {
        logger.info(
          `Player ${telegramId} is creator/admin and cannot be restricted via API. Relying on message deletion.`,
        );
        return;
      }

      // 5. Áp dụng giới hạn qua restrictChatMember
      await this.bot.telegram.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
      });

      logger.info(`Successfully muted player ${telegramId} in chat ${chatId} via Telegram API`);
    } catch (err: unknown) {
      logger.error(
        `Failed to mute player ${telegramId} in chat ${chatId} via Telegram API (falling back to message deletion): ${errorMessage(err)}`,
        { err },
      );
    }
  }

  /**
   * Restricts multiple players in a chat.
   */
  async mutePlayers(chatId: string | number, telegramIds: string[]): Promise<void> {
    await Promise.all(telegramIds.map((telegramId) => this.mutePlayer(chatId, telegramId)));
  }

  /**
   * Unmutes all players who were muted in this chat and clears the Redis set.
   * Restores all message permissions.
   */
  async unmuteAllPlayers(
    chatId: string | number,
    options: { clearFallbackOnFailure?: boolean } = {},
  ): Promise<void> {
    const key = this.getMutedPlayersKey(chatId);

    try {
      const mutedIds = await this.redis.smembers(key);
      if (!mutedIds || mutedIds.length === 0) {
        logger.debug(`No muted players found to unmute in chat ${chatId}.`);
        return;
      }

      logger.info(`Unmuting ${mutedIds.length} players in chat ${chatId}...`);

      const completedIds: string[] = [];
      const unmutePromises = mutedIds.map(async (telegramId) => {
        // Synthetic bottest players do not exist in Telegram. They are never
        // restricted by mutePlayer, but an old/stale Redis marker must still
        // be removable without calling getChatMember for an invalid ID.
        if (isTestBot(telegramId)) {
          completedIds.push(telegramId);
          return;
        }

        const userId = Number(telegramId);
        if (isNaN(userId)) {
          logger.warn(`Invalid muted ID in Redis for chat ${chatId}: "${telegramId}"`);
          completedIds.push(telegramId);
          return;
        }

        try {
          const targetMember = await this.bot.telegram.getChatMember(chatId, userId);
          const isCreatorOrAdmin = targetMember.status === 'creator' || targetMember.status === 'administrator';

          if (isCreatorOrAdmin) {
            // Admins/creators were never API-restricted, so their fallback
            // marker can be removed even though no lift call is needed.
            logger.info(`Skipping lift of API restrictions for creator/admin ${telegramId} in chat ${chatId}.`);
            completedIds.push(telegramId);
            return;
          }

          await this.bot.telegram.restrictChatMember(chatId, userId, {
            permissions: {
              can_send_messages: true,
              can_send_audios: true,
              can_send_documents: true,
              can_send_photos: true,
              can_send_videos: true,
              can_send_video_notes: true,
              can_send_voice_notes: true,
              can_send_polls: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true,
            },
          });
          completedIds.push(telegramId);
          logger.info(`Successfully unmuted player ${telegramId} in chat ${chatId}`);
        } catch (err: unknown) {
          logger.error(
            `Failed to unmute player ${telegramId} in chat ${chatId}: ${errorMessage(err)}`,
            { err },
          );
        }
      });

      await Promise.all(unmutePromises);

      // Retain failed IDs so the middleware can continue deleting speech and a
      // later recovery/retry can attempt the Telegram unrestriction again.
      if (completedIds.length === mutedIds.length || options.clearFallbackOnFailure === true) {
        // At a terminal boundary there is no live room left for middleware to
        // enforce. Keeping failed IDs would make a later unrelated session
        // inherit stale mute state for the same Telegram group.
        await this.redis.del(key);
      } else if (completedIds.length > 0) {
        await this.redis.srem(key, ...completedIds);
      }
    } catch (err: unknown) {
      logger.error(`Error in unmuteAllPlayers for chat ${chatId}: ${errorMessage(err)}`, { err });
    }
  }

  /**
   * Unmutes only the supplied players and removes successful IDs from the
   * Redis fallback set. This is intentionally narrower than
   * unmuteAllPlayers: when a night ends, living players may speak again while
   * players who died earlier must remain blocked.
   */
  async unmutePlayers(chatId: string | number, telegramIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(telegramIds)];
    if (uniqueIds.length === 0) return;

    const key = this.getMutedPlayersKey(chatId);
    const completedIds: string[] = [];

    await Promise.all(uniqueIds.map(async (telegramId) => {
      // Synthetic bottest players have no Telegram membership and must never
      // reach getChatMember/restrictChatMember.
      if (isTestBot(telegramId)) return;

      const userId = Number(telegramId);
      if (isNaN(userId)) {
        logger.warn(`Invalid player ID while unmuting in chat ${chatId}: "${telegramId}"`);
        completedIds.push(telegramId);
        return;
      }

      try {
        const targetMember = await this.bot.telegram.getChatMember(chatId, userId);
        const isCreatorOrAdmin = targetMember.status === 'creator' || targetMember.status === 'administrator';

        if (!isCreatorOrAdmin) {
          await this.bot.telegram.restrictChatMember(chatId, userId, {
            permissions: {
              can_send_messages: true,
              can_send_audios: true,
              can_send_documents: true,
              can_send_photos: true,
              can_send_videos: true,
              can_send_video_notes: true,
              can_send_voice_notes: true,
              can_send_polls: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true,
            },
          });
        }

        completedIds.push(telegramId);
        logger.info(`Successfully unmuted player ${telegramId} in chat ${chatId}`);
      } catch (err: unknown) {
        logger.error(
          `Failed to unmute player ${telegramId} in chat ${chatId}: ${errorMessage(err)}`,
          { err },
        );
      }
    }));

    if (completedIds.length > 0) {
      await this.redis.srem(key, ...completedIds);
    }
  }

  /**
   * Checks if a player is in the Redis set of muted players for a chat.
   */
  async isPlayerMuted(chatId: string | number, telegramId: string): Promise<boolean> {
    const key = this.getMutedPlayersKey(chatId);
    const result = await this.redis.sismember(key, telegramId);
    return result === 1;
  }
}
