import { HELP_TEXT, registerHelpCommand } from '../../../src/telegram/commands/help';

describe('/help command', () => {
  it('exposes the production command surface and onboarding flow', () => {
    expect(HELP_TEXT).toContain('🐺 WEREWOLF BOT');
    expect(HELP_TEXT).toContain('/start');
    expect(HELP_TEXT).toContain('/create');
    expect(HELP_TEXT).toContain('/join');
    expect(HELP_TEXT).toContain('/leave');
    expect(HELP_TEXT).toContain('/status');
    expect(HELP_TEXT).toContain('/vote');
    expect(HELP_TEXT).toContain('/startgame');
    expect(HELP_TEXT).toContain('/end');
    expect(HELP_TEXT).toContain('/bottest');
    expect(HELP_TEXT).toContain('Nếu chưa tạo game, /join sẽ báo phòng chưa tồn tại.');
  });

  it('stays within Telegram text limits and uses plain text formatting', () => {
    expect(HELP_TEXT.length).toBeLessThanOrEqual(4096);
    expect(HELP_TEXT).not.toContain('<b>');
    expect(HELP_TEXT).not.toContain('```');
    expect(HELP_TEXT.split('\n').length).toBeGreaterThan(25);
  });

  it('registers /help and replies with one complete string', async () => {
    let handler: ((ctx: any) => Promise<void>) | undefined;
    const bot = {
      command: jest.fn((_name: string, callback: (ctx: any) => Promise<void>) => {
        handler = callback;
      }),
    } as any;
    registerHelpCommand({} as any, bot);
    const reply = jest.fn().mockResolvedValue(undefined);
    await handler?.({ reply });
    expect(bot.command).toHaveBeenCalledWith('help', expect.any(Function));
    expect(reply).toHaveBeenCalledWith(HELP_TEXT);
    expect(typeof reply.mock.calls[0][0]).toBe('string');
  });
});
