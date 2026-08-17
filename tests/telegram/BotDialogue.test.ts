import { BotDialogue } from '../../src/telegram/BotDialogue';

describe('BotDialogue', () => {
  it('returns a deterministic humorous generic line and does not return an empty message', () => {
    const line = BotDialogue.generic(() => 0);
    expect(line).toContain('Chào buổi sáng');
    expect(line.trim()).not.toBe('');
  });

  it('renders Seer claims with the target nickname and no unresolved placeholder', () => {
    const wolfClaim = BotDialogue.seerClaim('Bot Sói', 'WEREWOLF', () => 0);
    const villageClaim = BotDialogue.seerClaim('Bot Dân', 'VILLAGE', () => 0);
    expect(wolfClaim).toContain('Bot Sói');
    expect(villageClaim).toContain('Bot Dân');
    expect(wolfClaim).not.toContain('{target}');
    expect(villageClaim).not.toContain('{target}');
  });

  it('changes reaction style by personality while keeping the bot nickname visible', () => {
    const deceptive = BotDialogue.reaction('Bot Lươn', 'deceptive', 'Bot Mục Tiêu', 'WEREWOLF', () => 0);
    const aggressive = BotDialogue.reaction('Bot Gắt', 'aggressive', 'Bot Mục Tiêu', 'WEREWOLF', () => 0);
    expect(deceptive).toContain('Bot Lươn');
    expect(aggressive).toContain('Bot Gắt');
    expect(deceptive).not.toContain('{target}');
    expect(aggressive).not.toContain('{target}');
  });

  it('provides a humorous execution reaction', () => {
    expect(BotDialogue.execution(() => 0)).toContain('Một người đã rời cuộc chơi');
  });
});
