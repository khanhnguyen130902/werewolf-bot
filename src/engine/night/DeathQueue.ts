import { PlayerState } from '../domain/Player';
import { RoleId, DeathCause } from '../domain/enums';

export interface PendingDeath {
  telegramId: string;
  cause: DeathCause;
  /**
   * Chain depth: 0 for an "original" death (werewolf kill, vote execution,
   * witch poison); 1 for a death caused by a Hunter's revenge shot reacting
   * to a depth-0 death. CONFIRMED BUSINESS RULE: Hunter revenge only
   * triggers off depth-0 deaths — a Hunter killed by another Hunter's
   * revenge shot (depth 1) does NOT get to fire back, preventing an infinite
   * domino chain. This field is what enforces that rule.
   */
  chainDepth: number;
}

export interface HunterShotDecision {
  hunterTelegramId: string;
  targetTelegramId: string | null; // null = Hunter declines to shoot
}

/**
 * Resolves a batch of deaths for a single night/execution, applying the
 * Hunter revenge-shot rule in a single controlled pass rather than an
 * open-ended recursive chain.
 *
 * Design rationale: SRS section 7 says to "resolve tất cả hiệu ứng" but does
 * not specify how deep chained reactions may go. Left unbounded, a
 * Hunter-kills-Hunter scenario could recurse indefinitely. The confirmed
 * rule (Hunter revenge only fires from depth-0 causes) makes the maximum
 * chain depth exactly 2 passes: original deaths, then at most one round of
 * Hunter revenge shots triggered by those original deaths. This class
 * encodes that as an explicit two-phase algorithm instead of unbounded
 * recursion, so termination is structurally guaranteed, not just "expected
 * to terminate because of the rule".
 *
 * SPLIT API (Phase 6 revision): resolving a Hunter's revenge shot in a real
 * deployment requires prompting the Hunter over Telegram and awaiting their
 * response (or a timeout) — an inherently asynchronous, I/O-bound operation
 * that cannot be represented as a synchronous callback invoked mid-resolve.
 * The original single-method `resolve()` API assumed the Hunter's decision
 * was already known synchronously, which cannot model "wait for a button
 * click". This class is therefore split into two synchronous steps with the
 * async gap living BETWEEN them, in the caller:
 *
 *   1. `resolveOriginalDeaths` — registers depth-0 deaths and returns both
 *      the resolved list AND the set of Hunters who need to be prompted.
 *   2. (caller awaits Telegram interaction for each pending Hunter here)
 *   3. `applyHunterDecisions` — takes the already-collected decisions and
 *      appends the resulting depth-1 deaths.
 *
 * This keeps DeathQueue itself pure and synchronous (no I/O, easy to unit
 * test) while making the async boundary explicit and owned entirely by the
 * caller (NightActionService/DayService), which is where Telegram-awaiting
 * logic belongs.
 */
export class DeathQueue {
  /**
   * Step 1: registers original (depth-0) deaths and identifies which of
   * them are Hunters whose death cause requires a revenge-shot prompt.
   */
  resolveOriginalDeaths(
    originalDeaths: Array<{ telegramId: string; cause: DeathCause }>,
    players: Record<string, PlayerState>,
    hunterTriggerCauses: DeathCause[],
  ): { resolved: PendingDeath[]; pendingHunterTelegramIds: string[] } {
    const resolved: PendingDeath[] = [];
    const alreadyDead = new Set<string>();

    for (const death of originalDeaths) {
      if (alreadyDead.has(death.telegramId)) continue;
      alreadyDead.add(death.telegramId);
      resolved.push({ ...death, chainDepth: 0 });
    }

    const pendingHunterTelegramIds = resolved
      .filter((d) => {
        const player = players[d.telegramId];
        const hasStoredTarget = Boolean(player?.hunterRevengeTarget);
        return (
          player?.role === RoleId.HUNTER &&
          hunterTriggerCauses.includes(d.cause) &&
          !hasStoredTarget
        );
      })
      .map((d) => d.telegramId);

    return { resolved, pendingHunterTelegramIds };
  }

  /**
   * Step 3: given the already-resolved depth-0 deaths and a map of Hunter
   * decisions collected by the caller (via Telegram prompt-and-await, or
   * null for "declined/timed out"), appends the resulting depth-1 deaths.
   * A Hunter who dies from a depth-1 shot is intentionally NEVER passed back
   * into this method for further chaining — the caller only invokes this
   * once per night/execution, which structurally guarantees the "no
   * domino" rule since there is no recursive re-entry point.
   */
  applyHunterDecisions(
    resolved: PendingDeath[],
    players: Record<string, PlayerState>,
    decisions: Record<string, HunterShotDecision | null>,
  ): PendingDeath[] {
    const alreadyDead = new Set(resolved.map((d) => d.telegramId));
    const result = [...resolved];

    const resolvedHunterIds = resolved
      .filter((d) => {
        const hunterPlayer = players[d.telegramId];
        return hunterPlayer?.role === RoleId.HUNTER;
      })
      .map((d) => d.telegramId);

    for (const hunterTelegramId of resolvedHunterIds) {
      const hunterPlayer = players[hunterTelegramId];
      const explicitDecision = decisions[hunterTelegramId];
      const targetId = explicitDecision?.targetTelegramId ?? hunterPlayer?.hunterRevengeTarget ?? null;

      if (targetId === null) {
        continue;
      }
      if (alreadyDead.has(targetId)) {
        continue;
      }
      const targetPlayer = players[targetId];
      if (!targetPlayer || !targetPlayer.alive) {
        continue;
      }
      alreadyDead.add(targetId);
      result.push({
        telegramId: targetId,
        cause: DeathCause.HUNTER_SHOT,
        chainDepth: 1,
      });
      void hunterTelegramId; // decision's source hunter, kept for readability/debugging
    }

    return result;
  }

  /**
   * Convenience wrapper combining both steps for callers that already have
   * every Hunter decision available synchronously (e.g. unit tests, or a
   * hypothetical future platform where the "prompt" is instant). Real
   * Telegram flows should use resolveOriginalDeaths + applyHunterDecisions
   * directly with an await in between.
   */
  resolve(
    originalDeaths: Array<{ telegramId: string; cause: DeathCause }>,
    players: Record<string, PlayerState>,
    hunterTriggerCauses: DeathCause[],
    getHunterDecision: (hunterTelegramId: string) => HunterShotDecision | null,
  ): PendingDeath[] {
    const { resolved, pendingHunterTelegramIds } = this.resolveOriginalDeaths(
      originalDeaths,
      players,
      hunterTriggerCauses,
    );
    const decisions: Record<string, HunterShotDecision | null> = {};
    for (const hunterTelegramId of pendingHunterTelegramIds) {
      decisions[hunterTelegramId] = getHunterDecision(hunterTelegramId);
    }
    return this.applyHunterDecisions(resolved, players, decisions);
  }
}
