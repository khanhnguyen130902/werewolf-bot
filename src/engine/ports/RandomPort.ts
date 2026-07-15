/**
 * Randomness abstraction. Role assignment shuffling and "random target on
 * timeout" (Suggestion #10) both need randomness; injecting it via an
 * interface lets tests use a seeded/deterministic implementation instead of
 * Math.random(), which is important for reliably testing role-distribution
 * fairness and win-condition edge cases.
 */
export interface RandomPort {
  /** Returns a float in [0, 1), same contract as Math.random(). */
  next(): number;

  /** Returns a shuffled copy of the array (Fisher-Yates using `next()`). */
  shuffle<T>(items: T[]): T[];

  /** Returns a random element of a non-empty array. */
  pick<T>(items: T[]): T;
}

export class SystemRandom implements RandomPort {
  next(): number {
    return Math.random();
  }

  shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  pick<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return items[Math.floor(this.next() * items.length)];
  }
}
