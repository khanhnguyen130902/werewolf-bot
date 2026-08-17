import { RoleId, Team } from '../../src/engine/domain/enums';
import { BotPolicy } from '../../src/telegram/BotPolicy';

describe('BotPolicy', () => {
  const baseRoom = {
    currentRound: 1,
    pendingNightActions: [],
    players: {
      botSeer: { telegramId: 'botSeer', role: RoleId.SEER, alive: true },
      wolf: { telegramId: 'wolf', role: RoleId.WEREWOLF, alive: true },
      villager: { telegramId: 'villager', role: RoleId.VILLAGER, alive: true },
    },
    lastProtectedByBodyguard: {},
    lastTargetedByHunter: {},
  } as any;

  it('keeps inspection knowledge private to the seer bot and exposes telemetry only for recorded observations', () => {
    const policy = new BotPolicy({ random: () => 0.99 });
    policy.startRoom('room-1');
    policy.recordInspection('room-1', {
      seerTelegramId: 'botSeer',
      targetTelegramId: 'wolf',
      targetNickname: 'Wolf',
      revealedTeam: Team.WEREWOLF,
      revealedRole: RoleId.WEREWOLF,
    });

    const state = policy.getState('room-1');
    expect(state.knownWerewolvesByBot.get('botSeer')?.has('wolf')).toBe(true);
    expect(state.knownWerewolvesByBot.get('otherBot')).toBeUndefined();

    policy.recordObservation('room-1', {
      type: 'ACCUSATION',
      round: 1,
      actorTelegramId: 'botSeer',
      targetTelegramId: 'wolf',
      text: 'seer-claim',
    });
    policy.recordObservation('room-1', {
      type: 'VOTE',
      round: 1,
      actorTelegramId: 'botSeer',
      targetTelegramId: null,
    });

    expect(policy.getTelemetry('room-1')).toMatchObject({
      observationCount: 2,
      accusationCount: 1,
      voteCount: 1,
      skipVoteCount: 1,
    });
  });

  it('lets a Seer vote for a privately confirmed wolf without exposing the role to other bots', () => {
    const policy = new BotPolicy({ random: () => 0.99 });
    policy.startRoom('room-1');
    policy.recordInspection('room-1', {
      seerTelegramId: 'botSeer',
      targetTelegramId: 'wolf',
      targetNickname: 'Wolf',
      revealedTeam: Team.WEREWOLF,
      revealedRole: RoleId.WEREWOLF,
    });

    const target = policy.chooseVoteTarget(
      baseRoom,
      baseRoom.players.botSeer,
      [
        { telegramId: 'botSeer', nickname: 'Seer' },
        { telegramId: 'wolf', nickname: 'Wolf' },
        { telegramId: 'villager', nickname: 'Villager' },
      ],
      'room-1',
    );

    expect(target?.telegramId).toBe('wolf');
    expect(policy.getState('room-1').knownWerewolvesByBot.get('otherBot')).toBeUndefined();
  });

  it('supports personality-specific behavior and deterministic Skip decisions', () => {
    const policy = new BotPolicy({
      random: () => 0.1,
      personalityByBot: new Map([['cautiousBot', 'cautious']]),
    });
    expect(policy.getPersonality('cautiousBot')).toBe('cautious');
    expect(policy.getPersonality('aggressiveBot1')).toBe('aggressive');

    const target = policy.chooseVoteTarget(
      baseRoom,
      { telegramId: 'cautiousBot', role: RoleId.VILLAGER, alive: true } as any,
      [
        { telegramId: 'cautiousBot', nickname: 'Cautious' },
        { telegramId: 'wolf', nickname: 'Wolf' },
      ],
      'room-1',
    );
    expect(target).toBeNull();
  });

  it('can consume an inspection once and clear the room policy state', () => {
    const policy = new BotPolicy({ random: () => 0.99 });
    policy.startRoom('room-1');
    policy.recordInspection('room-1', {
      seerTelegramId: 'botSeer',
      targetTelegramId: 'wolf',
      targetNickname: 'Wolf',
      revealedTeam: Team.WEREWOLF,
      revealedRole: RoleId.WEREWOLF,
    });

    expect(policy.consumeLastInspection('room-1')?.targetTelegramId).toBe('wolf');
    expect(policy.consumeLastInspection('room-1')).toBeUndefined();
    policy.clearRoom('room-1');
    expect(policy.getTelemetry('room-1').observationCount).toBe(0);
  });
});
