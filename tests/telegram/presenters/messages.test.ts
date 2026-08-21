import { Messages } from '../../../src/telegram/presenters/messages';

describe('Messages.dayBegins', () => {
  it('lists only the names of players who died overnight', () => {
    const message = Messages.dayBegins(1, [
      { nickname: 'Bot1' },
      { nickname: 'Bot3' },
    ]);
    expect(message).toContain('Bình minh ngày 1');
    expect(message).toContain('Bot1 đã chết');
    expect(message).toContain('Bot3 đã chết');
    expect(message).not.toContain('Bot2');
  });
});
