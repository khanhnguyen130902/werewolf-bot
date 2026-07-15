export interface VoteSubmission {
  voterTelegramId: string;
  /** null represents an explicit abstain/blank vote (CONFIRMED RULE: blank
   * votes are allowed and simply don't count toward anyone's tally). */
  targetTelegramId: string | null;
}

export interface VoteResolutionResult {
  /** telegramId of the player to execute, or null if no one is executed
   * (CONFIRMED RULE: a tie results in no execution — see class doc). */
  executedTelegramId: string | null;
  /** Vote counts per candidate, for transparency/display purposes
   * (SRS-style "ai bị bao nhiêu phiếu"). Abstains are not included here
   * since they target no one. */
  voteCounts: Record<string, number>;
  /** Number of players who submitted an explicit blank/abstain vote. */
  abstainCount: number;
}

/**
 * Pure vote-tallying logic for the day's execution vote (SRS section 5:
 * DISCUSSION -> VOTING -> EXECUTION).
 *
 * CONFIRMED BUSINESS RULES (product owner decisions, since SRS does not
 * specify tie-breaking or abstain handling):
 *   1. Blank/abstain votes ARE allowed (a player may submit `targetTelegramId:
 *      null`) and are simply excluded from every candidate's tally — they
 *      cannot cause anyone to be executed.
 *   2. If the highest vote count is shared by two or more candidates (a
 *      tie), NO ONE is executed that day. This is the safest default: it
 *      avoids accidentally executing multiple innocents on a coin-flip and
 *      matches the traditional Werewolf/Mafia ruling that a tied vote fails
 *      to reach the majority needed to execute.
 *   3. Werewolves vote exactly like Villagers — one vote per living player,
 *      with no team-based weighting or visibility difference. This keeps
 *      voting mechanics simple and matches the classic ruleset; SRS does not
 *      call for hidden/weighted wolf votes.
 *
 * Implemented as a stateless class (no constructor dependencies) since vote
 * tallying is pure arithmetic with no randomness or side effects needed —
 * this differs from NightResolver's werewolf-kill tally, which uses
 * RandomPort to break ties; here ties deliberately do NOT need randomness
 * because the rule is "no execution", not "pick one at random".
 */
export class VoteResolver {
  resolve(submissions: VoteSubmission[]): VoteResolutionResult {
    const voteCounts: Record<string, number> = {};
    let abstainCount = 0;

    for (const submission of submissions) {
      if (submission.targetTelegramId === null) {
        abstainCount++;
        continue;
      }
      voteCounts[submission.targetTelegramId] =
        (voteCounts[submission.targetTelegramId] ?? 0) + 1;
    }

    const entries = Object.entries(voteCounts);
    if (entries.length === 0) {
      return { executedTelegramId: null, voteCounts, abstainCount };
    }

    const maxVotes = Math.max(...entries.map(([, count]) => count));
    const topCandidates = entries.filter(([, count]) => count === maxVotes);

    const executedTelegramId =
      topCandidates.length === 1 ? topCandidates[0][0] : null;

    return { executedTelegramId, voteCounts, abstainCount };
  }
}
