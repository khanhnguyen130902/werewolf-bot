import { parseActionCallbackData } from '../../src/telegram/presenters/keyboards';

describe('callback payload security parser', () => {
  it.each([
    '',
    'vote:VOTE:target',
    'action',
    'action:VOTE',
    'action::target',
  ])('rejects malformed callback data %j', (payload) => {
    expect(parseActionCallbackData(payload)).toBeNull();
  });

  it('rejects callback payloads larger than Telegram callback_data limit', () => {
    expect(parseActionCallbackData(`action:VOTE:${'x'.repeat(60)}`)).toBeNull();
  });

  it('parses legacy action payloads without inventing a ballot scope', () => {
    expect(parseActionCallbackData('action:SEER_INSPECT:target-1')).toEqual({
      actionType: 'SEER_INSPECT',
      ballotId: null,
      targetTelegramId: 'target-1',
    });
  });

  it('keeps ballot identity intact when target contains separator-like text', () => {
    expect(parseActionCallbackData('action:VOTE:room1-ballot-7:target:with:colon')).toEqual({
      actionType: 'VOTE',
      ballotId: 'room1-ballot-7:target:with',
      targetTelegramId: 'colon',
    });
  });

  it('normalizes SKIP to null for both legacy and ballot-scoped payloads', () => {
    expect(parseActionCallbackData('action:VOTE:SKIP')).toEqual({
      actionType: 'VOTE',
      ballotId: null,
      targetTelegramId: null,
    });
    expect(parseActionCallbackData('action:VOTE:room1-ballot-7:SKIP')).toEqual({
      actionType: 'VOTE',
      ballotId: 'room1-ballot-7',
      targetTelegramId: null,
    });
  });
});
