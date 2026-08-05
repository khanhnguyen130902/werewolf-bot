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
    };
    service = new MuteService(bot, redis);
  });

  it('always adds player to Redis when muting (fallback for message deletion)', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'group' }); // group chat type means restrict API is skipped

    await service.mutePlayer('chat123', '55555');

    // Verify it added player to Redis anyway
    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    // Verify Telegram restrict API was NOT called because it is not a supergroup
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
  });

  it('restricts member via API in supergroup if bot has permission', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'supergroup' });
    bot.telegram.getChatMember
      .mockResolvedValueOnce({ status: 'administrator', can_restrict_members: true }) // bot is admin with restrict perm
      .mockResolvedValueOnce({ status: 'member' }); // target is a regular member (can be restricted)

    await service.mutePlayer('chat123', '55555');

    // Verify added to Redis
    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    // Verify Telegram restrict API was called
    expect(bot.telegram.restrictChatMember).toHaveBeenCalledWith('chat123', 55555, expect.any(Object));
  });

  it('skips restrict API but saves to Redis if target is creator/admin', async () => {
    bot.telegram.getChat.mockResolvedValue({ type: 'supergroup' });
    bot.telegram.getChatMember
      .mockResolvedValueOnce({ status: 'administrator', can_restrict_members: true }) // bot is admin
      .mockResolvedValueOnce({ status: 'administrator' }); // target is an admin (cannot be restricted)

    await service.mutePlayer('chat123', '55555');

    // Verify added to Redis
    expect(redis.sadd).toHaveBeenCalledWith('muted-players:chat123', '55555');
    // Verify Telegram restrict API was NOT called
    expect(bot.telegram.restrictChatMember).not.toHaveBeenCalled();
  });
});
