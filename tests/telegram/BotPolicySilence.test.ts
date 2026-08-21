import { BotPolicy } from '../../src/telegram/BotPolicy';
import { GameState, RoleId, Team } from '../../src/engine/domain/enums';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { RoomFactory } from '../../src/engine/domain/Room';

describe('BotPolicy Silence Gate contract', () => {
  function fixture() {
    const room = RoomFactory.create({ id: 'bot-room', hostTelegramId: 'bot-1', chatId: 'chat', now: 1 });
    room.gameState = GameState.DISCUSSION;
    room.matchId = 'match';
    room.currentRound = 1;
    room.discussionCycleId = 'match:discussion:1';
    room.discussionLifecycle = 'ACTIVE';
    room.discussionEnforcementReady = true;
    const bot = {
      ...PlayerFactory.create({ telegramId: 'bot-1', nickname: 'Bot', joinedAt: 1 }),
      role: RoleId.VILLAGER,
      team: Team.VILLAGE,
    };
    room.players[bot.telegramId] = bot;
    return { room, bot, policy: new BotPolicy({ random: () => 0 }) };
  }

  it('denies normal speech during opening', () => {
    const { room, bot, policy } = fixture();
    room.discussionLifecycle = 'OPENING';
    room.discussionEnforcementReady = false;
    expect(policy.canSpeak(room, bot)).toBe('DENY');
  });

  it('denies active silenced bot speech', () => {
    const { room, bot, policy } = fixture();
    room.silencedPlayerId = bot.telegramId;
    room.silencedUntilRound = room.currentRound;
    room.silencedDiscussionCycleId = room.discussionCycleId;
    expect(policy.canSpeak(room, bot)).toBe('DENY');
  });

  it('allows an alive non-silenced bot during active discussion', () => {
    const { room, bot, policy } = fixture();
    expect(policy.canSpeak(room, bot)).toBe('ALLOW');
  });

  it('denies dead bots regardless of lifecycle', () => {
    const { room, bot, policy } = fixture();
    bot.alive = false;
    expect(policy.canSpeak(room, bot)).toBe('DENY');
  });
});
