import { buildVoteKeyboard, parseActionCallbackData } from '../../src/telegram/presenters/keyboards';

describe('ballot callback token contract', () => {
  it('embeds ballotId in every vote callback', () => {
    const keyboard = buildVoteKeyboard({
      ballotId: 'match-1:round-2:ballot-7',
      targets: [{ telegramId: 'target', nickname: 'Target' }],
      voteCounts: {},
      skipCount: 0,
    });
    const markup = keyboard.reply_markup;
    if (!markup || !('inline_keyboard' in markup)) throw new Error('missing inline keyboard');
    const firstButton = markup.inline_keyboard[0][0];
    if (!('callback_data' in firstButton)) throw new Error('missing callback data');
    const callbackData = firstButton.callback_data;
    expect(callbackData).toBe('action:VOTE:match-1:round-2:ballot-7:target');
    expect(parseActionCallbackData(callbackData)).toEqual({
      actionType: 'VOTE',
      ballotId: 'match-1:round-2:ballot-7',
      targetTelegramId: 'target',
    });
  });

  it('keeps legacy three-part callbacks parseable for non-ballot actions', () => {
    expect(parseActionCallbackData('action:SEER_INSPECT:target')).toEqual({
      actionType: 'SEER_INSPECT',
      ballotId: null,
      targetTelegramId: 'target',
    });
  });
});
