import { VoteResolver } from '../../src/engine/voting/VoteResolver';

describe('VoteResolver', () => {
  const resolver = new VoteResolver();

  it('executes the candidate with the most votes', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
      { voterTelegramId: 'v2', targetTelegramId: 'target1' },
      { voterTelegramId: 'v3', targetTelegramId: 'target2' },
    ]);
    expect(result.executedTelegramId).toBe('target1');
    expect(result.voteCounts).toEqual({ target1: 2, target2: 1 });
  });

  it('CONFIRMED RULE: a tie results in no execution', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
      { voterTelegramId: 'v2', targetTelegramId: 'target2' },
    ]);
    expect(result.executedTelegramId).toBeNull();
    expect(result.voteCounts).toEqual({ target1: 1, target2: 1 });
  });

  it('CONFIRMED RULE: a 3-way tie also results in no execution', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
      { voterTelegramId: 'v2', targetTelegramId: 'target2' },
      { voterTelegramId: 'v3', targetTelegramId: 'target3' },
    ]);
    expect(result.executedTelegramId).toBeNull();
  });

  it('CONFIRMED RULE: abstain votes can block execution when they reach the highest tally', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
      { voterTelegramId: 'v2', targetTelegramId: null },
      { voterTelegramId: 'v3', targetTelegramId: null },
    ]);
    expect(result.executedTelegramId).toBeNull();
    expect(result.abstainCount).toBe(2);
    expect(result.voteCounts).toEqual({ target1: 1 });
  });

  it('returns no execution when everyone abstains', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: null },
      { voterTelegramId: 'v2', targetTelegramId: null },
    ]);
    expect(result.executedTelegramId).toBeNull();
    expect(result.abstainCount).toBe(2);
    expect(result.voteCounts).toEqual({});
  });

  it('does not execute anyone when abstain votes outnumber the leading candidate', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
      { voterTelegramId: 'v2', targetTelegramId: 'target1' },
      { voterTelegramId: 'v3', targetTelegramId: null },
      { voterTelegramId: 'v4', targetTelegramId: null },
      { voterTelegramId: 'v5', targetTelegramId: null },
    ]);
    expect(result.executedTelegramId).toBeNull();
    expect(result.abstainCount).toBe(3);
    expect(result.voteCounts).toEqual({ target1: 2 });
  });

  it('returns no execution when there are no submissions at all', () => {
    const result = resolver.resolve([]);
    expect(result.executedTelegramId).toBeNull();
    expect(result.voteCounts).toEqual({});
    expect(result.abstainCount).toBe(0);
  });

  it('werewolves vote identically to villagers (no special weighting)', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'wolf1', targetTelegramId: 'target1' },
      { voterTelegramId: 'villager1', targetTelegramId: 'target1' },
      { voterTelegramId: 'villager2', targetTelegramId: 'target2' },
    ]);
    expect(result.voteCounts).toEqual({ target1: 2, target2: 1 });
    expect(result.executedTelegramId).toBe('target1');
  });

  it('single voter, single candidate results in that candidate being executed', () => {
    const result = resolver.resolve([
      { voterTelegramId: 'v1', targetTelegramId: 'target1' },
    ]);
    expect(result.executedTelegramId).toBe('target1');
  });
});
