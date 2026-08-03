import { Messages } from '../../../src/telegram/presenters/messages';

describe('Messages.dayBegins', () => {
  it('lists only the names of players who died overnight', () => {
    expect(
      Messages.dayBegins(1, [
        { nickname: 'Bot1' },
        { nickname: 'Bot3' },
      ]),
    ).toBe('☀️ BÌNH MINH NGÀY 1\n\n💀 Người đã ra đi đêm qua: Bot1, Bot3');
  });
});
