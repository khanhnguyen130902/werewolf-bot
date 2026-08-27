import { registerStartCommand } from '../../../src/telegram/commands/start';
import { registerCreateCommand } from '../../../src/telegram/commands/create';
import { registerJoinCommand } from '../../../src/telegram/commands/join';
import { registerLeaveCommand } from '../../../src/telegram/commands/leave';
import { registerStartGameCommand } from '../../../src/telegram/commands/startgame';
import { registerStatusCommand } from '../../../src/telegram/commands/status';
import { registerVoteCommand } from '../../../src/telegram/commands/vote';
import { registerEndCommand } from '../../../src/telegram/commands/end';
import { registerbottestCommand } from '../../../src/telegram/commands/bottest';
import { registerHelpCommand } from '../../../src/telegram/commands/help';

type RegisterCommand = (bot: any) => void;

const registrations: Array<[string, RegisterCommand]> = [
  ['start', (bot) => registerStartCommand({} as any, bot)],
  ['create', (bot) => registerCreateCommand({} as any, {} as any, bot)],
  ['join', (bot) => registerJoinCommand({} as any, bot)],
  ['leave', (bot) => registerLeaveCommand({} as any, bot)],
  ['startgame', (bot) => registerStartGameCommand({} as any, {} as any, bot)],
  ['status', (bot) => registerStatusCommand({} as any, bot)],
  ['vote', (bot) => registerVoteCommand({} as any, {} as any, bot)],
  ['end', (bot) => registerEndCommand({} as any, {} as any, bot)],
  ['bottest', (bot) => registerbottestCommand({} as any, bot)],
  ['help', (bot) => registerHelpCommand({} as any, bot)],
];

describe('Telegram command casing', () => {
  it.each(registrations)('registers /%s case-insensitively', (commandName, register) => {
    const bot = { command: jest.fn() };

    register(bot);

    expect(bot.command).toHaveBeenCalledTimes(1);
    const matcher = bot.command.mock.calls[0][0] as RegExp;
    expect(matcher).toEqual(new RegExp(`^${commandName}$`, 'i'));
    expect(matcher.test(commandName)).toBe(true);
    expect(matcher.test(commandName.toUpperCase())).toBe(true);
    expect(matcher.test(`${commandName.slice(0, 1).toUpperCase()}${commandName.slice(1)}`)).toBe(true);
    expect(matcher.test(`${commandName}extra`)).toBe(false);
  });
});

function isEndCommand(text: string): boolean {
  return /^\/end(?:\s|@|$)/i.test(text);
}

describe('uppercase /end middleware bypass detection', () => {
  it('recognizes uppercase and mixed-case /end commands without matching longer words', () => {
    expect(isEndCommand('/end')).toBe(true);
    expect(isEndCommand('/END')).toBe(true);
    expect(isEndCommand('/EnD @werewolf_bot')).toBe(true);
    expect(isEndCommand('/ending')).toBe(false);
  });
});

