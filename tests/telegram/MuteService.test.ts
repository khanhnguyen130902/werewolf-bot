import { MuteService } from '../../src/telegram/MuteService';

describe('MuteService', () => {
  let bot: any;
  let redis: any;
  let service: MuteService;

  beforeEach(() => {
    bot = {
      telegram: {
        getChat: jest.fn(),
        getMe: jest.fn().mockResolvedValue({ id: 100 }),
        getChatMember: jest.fn(),
        restrictChatMember: jest.fn(),
      },
    };
    redis = {
      sadd: jest.fn(),
      smembers: jest.fn(),
      sismember: jest.fn(),
      del: jest.fn(),
      srem: jest.fn(),
    };
    service = new MuteService(bot, redis);
  });

  it('always adds player to Redis when muting (fallback for message deletion)', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'group' });

    await service.mutePlayer('chat123', '55555');

    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
  });

  it('restricts member via API in supergroup if bot has permission', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'supergroup' });
    bot.telegram.getChatMember
      .mockResolvedValueOnce({ status: 'administrator', can_restrict_members: true })
      .mockResolvedValueOnce({ status: 'member' });

    await service.mutePlayer('chat123', '55555');

    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    expect(bot.telegram.restrictChatMember).toHaveBeenCalledWith('chat123', 55555, expect.any(Object));
  });

  it('skips restrict API but saves to Redis if target is creator/admin', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'supergroup' });
    bot.telegram.getChatMember
      .mockResolvedValueOnce({ status: 'administrator', can_restrict_members: true })
      .mockResolvedValueOnce({ status: 'administrator' });

    await service.mutePlayer('chat123', '55555');

    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
  });

  it('clears the Redis set after every player is successfully unmuted', async () => {
    redis.smembers.mockResolvedValue(['55555']);
    bot.telegram.getChatMember.mockResolvedValue({ status: 'member' });

    await service.unmuteAllPlayers('chat123');

    expect(bot.telegram.restrictChatMember).toHaveBeenCalledWith('chat123', 55555, expect.any(Object));
    expect(redis.del).toHaveBeenCalledWith('muted-players:chat123');
    expect(redis.srem).not.toHaveBeenCalled();
  });

  it('retains failed unmute IDs for middleware fallback and later recovery', async () => {
    redis.smembers.mockResolvedValue(['11111', '22222']);
    bot.telegram.getChatMember.mockImplementation(async () => ({ status: 'member' }));
    bot.telegram.restrictChatMember.mockImplementation(async (_chatId: string, userId: number) => {
      if (userId === 11111) throw new Error('telegram 500');
      return undefined;
    });

    await service.unmuteAllPlayers('chat123');

    expect(redis.srem).toHaveBeenCalledWith('muted-players:chat123', '22222');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('unmutes only the supplied players and removes successful IDs from the fallback set', async () => {
    redis.srem.mockResolvedValue(1);
    bot.telegram.getChatMember.mockResolvedValue({ status: 'member' });

    await service.unmutePlayers('chat123', ['55555', '55555', '66666']);

    expect(bot.telegram.getChatMember).toHaveBeenCalledTimes(2);
    expect(bot.telegram.restrictChatMember).toHaveBeenCalledTimes(2);
    expect(redis.srem).toHaveBeenCalledWith(
      'muted-players:chat123',
      expect.any(String),
      expect.any(String),
    );
    const removedIds = redis.srem.mock.calls[0].slice(1);
    expect(removedIds).toEqual(expect.arrayContaining(['55555', '66666']));
  });

  it('does not call Telegram APIs for synthetic bottest players during unmute', async () => {
    redis.srem.mockResolvedValue(1);

    await service.unmutePlayers('chat123', ['9999999004']);

    expect(bot.telegram.getChatMember).not.toHaveBeenCalled();
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
    expect(redis.srem).not.toHaveBeenCalled();
  });

  it('cleans stale synthetic bottest IDs without calling Telegram during full unmute', async () => {
    redis.smembers.mockResolvedValue(['9999999004']);

    await service.unmuteAllPlayers('chat123');

    expect(bot.telegram.getChatMember).not.toHaveBeenCalled();
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('muted-players:chat123');
  });

  it('clears fallback markers after terminal cleanup even when Telegram unmute fails', async () => {
    redis.smembers.mockResolvedValue(['55555']);
    bot.telegram.getChatMember.mockRejectedValue(new Error('telegram unavailable'));

    await service.unmuteAllPlayers('chat123', { clearFallbackOnFailure: true });

    expect(redis.del).toHaveBeenCalledWith('muted-players:chat123');
  });
});
