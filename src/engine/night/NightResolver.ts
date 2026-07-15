import { RoomState } from '../domain/Room';
import { PlayerState, killPlayer, resetNightFlags } from '../domain/Player';
import { DeathCause, NightActionType } from '../domain/enums';
import { NightActionSubmission, NightResolutionResult } from './NightAction';
import { DeathQueue } from './DeathQueue';
import { RandomPort } from '../ports/RandomPort';

/**
 * Groups all submissions by actionType for straightforward lookup during
 * the ordered resolution pass.
 */
function groupByType(
  submissions: NightActionSubmission[],
): Record<string, NightActionSubmission[]> {
  const groups: Record<string, NightActionSubmission[]> = {};
  for (const s of submissions) {
    (groups[s.actionType] ??= []).push(s);
  }
  return groups;
}

/**
 * The central night-resolution pipeline (SRS section 7: "Sói -> Bảo vệ ->
 * Tiên tri -> Phù thủy -> Resolve tất cả hiệu ứng -> Check win").
 *
 * Processing order is driven entirely by `settings.nightActionOrder`
 * (a configurable list of NightActionType strings) rather than a hard-coded
 * sequence — this satisfies the SRS requirement that night order be
 * changeable via Game Engine configuration, and lets a future game mode
 * reorder or omit steps without touching this class's code.
 *
 * CONFIRMED BUSINESS RULES applied here:
 *   1. Bodyguard protection and Witch's save potion are independent and
 *      stack: if either protects/saves the werewolves' target, the target
 *      survives. Using the save potion always consumes it, even if the
 *      Bodyguard already protected the same target (no wasted-potion
 *      refund).
 *   2. The Witch MAY target herself with the save potion (e.g. if she was
 *      the werewolves' victim) and will survive if so.
 *   3. The Seer's inspection result is computed and attached to the
 *      resolution result BEFORE the death queue is applied — so a Seer who
 *      is killed the same night still receives their private result. This
 *      is achieved structurally by computing seerResults in the same pass
 *      as other actions, prior to the death-queue step, and returning both
 *      in one NightResolutionResult that the caller delivers together.
 *   4. Hunter revenge-shot chaining is delegated to DeathQueue, which caps
 *      the chain at depth 1 (no domino of Hunter-kills-Hunter-kills-Hunter).
 */
export class NightResolver {
  constructor(private readonly random: RandomPort) {}

  /**
   * Step 1 of the split resolution flow (see DeathQueue's class doc for the
   * rationale): runs the entire configured night-action pipeline (werewolf
   * vote, bodyguard protect, seer inspect, witch save/poison) and determines
   * original (depth-0) deaths, but does NOT yet apply Hunter revenge shots —
   * it only identifies which Hunters (if any) died from a trigger cause and
   * therefore need to be prompted. The caller is expected to await a real
   * Telegram interaction for each pending Hunter, then call
   * `applyHunterRevengeAndFinalize` with the collected decisions.
   *
   * Player state mutations (killPlayer, resetNightFlags) are intentionally
   * NOT applied yet at this step — finalizing player state before Hunter
   * revenge is resolved would require a second mutation pass anyway, so all
   * state application is deferred to `applyHunterRevengeAndFinalize` to keep
   * "when is the room state actually finalized" unambiguous (exactly once,
   * in exactly one method).
   */
  resolveWithoutHunterRevenge(params: {
    room: RoomState;
    submissions: NightActionSubmission[];
  }): {
    depth0Deaths: Array<{ telegramId: string; cause: DeathCause }>;
    pendingHunterTelegramIds: string[];
    seerResults: NightResolutionResult['seerResults'];
    rejectedActions: NightResolutionResult['rejectedActions'];
    witchPotions: RoomState['witchPotions'];
    lastProtectedByBodyguard: RoomState['lastProtectedByBodyguard'];
  } {
    const { room } = params;
    const settings = room.settings;
    const grouped = groupByType(params.submissions);
    const alivePlayerIds = Object.values(room.players)
      .filter((p) => p.alive)
      .map((p) => p.telegramId);

    let witchPotions = room.witchPotions ? { ...room.witchPotions } : null;
    const lastProtectedByBodyguard = { ...room.lastProtectedByBodyguard };

    const rejectedActions: NightResolutionResult['rejectedActions'] = [];
    const seerResults: NightResolutionResult['seerResults'] = [];

    let werewolfVictimId: string | null = null;
    const protectedThisNight = new Set<string>();
    const savedThisNight = new Set<string>();
    let poisonedTargetId: string | null = null;

    for (const actionType of settings.nightActionOrder as NightActionType[]) {
      const actionsOfType = grouped[actionType] ?? [];

      switch (actionType) {
        case NightActionType.WEREWOLF_VOTE_KILL: {
          werewolfVictimId = this.resolveWerewolfVote(actionsOfType);
          break;
        }

        case NightActionType.BODYGUARD_PROTECT: {
          for (const action of actionsOfType) {
            if (action.targetTelegramId) {
              protectedThisNight.add(action.targetTelegramId);
              lastProtectedByBodyguard[action.actorTelegramId] = action.targetTelegramId;
            } else {
              lastProtectedByBodyguard[action.actorTelegramId] = null;
            }
          }
          break;
        }

        case NightActionType.SEER_INSPECT: {
          for (const action of actionsOfType) {
            if (!action.targetTelegramId) continue;
            const targetPlayer = room.players[action.targetTelegramId];
            if (!targetPlayer || !targetPlayer.role || !targetPlayer.team) continue;
            seerResults.push({
              seerTelegramId: action.actorTelegramId,
              targetTelegramId: action.targetTelegramId,
              revealedTeam: targetPlayer.team,
              revealedRole: settings.seerRevealsExactRole ? targetPlayer.role : null,
            });
          }
          break;
        }

        case NightActionType.WITCH_SAVE: {
          for (const action of actionsOfType) {
            if (!action.targetTelegramId) continue;
            if (!witchPotions || witchPotions.saveUsed) {
              rejectedActions.push({
                actionId: action.actionId,
                reason: 'NO_POTION_LEFT:save',
              });
              continue;
            }
            savedThisNight.add(action.targetTelegramId);
            witchPotions = { ...witchPotions, saveUsed: true };
          }
          break;
        }

        case NightActionType.WITCH_POISON: {
          for (const action of actionsOfType) {
            if (!action.targetTelegramId) continue;
            if (!witchPotions || witchPotions.poisonUsed) {
              rejectedActions.push({
                actionId: action.actionId,
                reason: 'NO_POTION_LEFT:poison',
              });
              continue;
            }
            poisonedTargetId = action.targetTelegramId;
            witchPotions = { ...witchPotions, poisonUsed: true };
          }
          break;
        }

        default:
          break;
      }
    }

    const depth0Deaths: Array<{ telegramId: string; cause: DeathCause }> = [];

    if (
      werewolfVictimId &&
      !protectedThisNight.has(werewolfVictimId) &&
      !savedThisNight.has(werewolfVictimId)
    ) {
      depth0Deaths.push({ telegramId: werewolfVictimId, cause: DeathCause.WEREWOLF_KILL });
    }

    if (poisonedTargetId && alivePlayerIds.includes(poisonedTargetId)) {
      depth0Deaths.push({ telegramId: poisonedTargetId, cause: DeathCause.WITCH_POISON });
    }

    const deathQueue = new DeathQueue();
    const { pendingHunterTelegramIds } = deathQueue.resolveOriginalDeaths(
      depth0Deaths,
      room.players,
      settings.hunterTriggerCauses as DeathCause[],
    );

    return {
      depth0Deaths,
      pendingHunterTelegramIds,
      seerResults,
      rejectedActions,
      witchPotions,
      lastProtectedByBodyguard,
    };
  }

  /**
   * Step 2 of the split resolution flow: takes the output of
   * `resolveWithoutHunterRevenge` plus the caller-collected Hunter revenge
   * decisions (obtained by awaiting a real Telegram prompt for each id in
   * `pendingHunterTelegramIds`), applies all deaths and finalizes the room's
   * player states (including the per-night flag reset).
   */
  applyHunterRevengeAndFinalize(params: {
    room: RoomState;
    stepOneResult: ReturnType<NightResolver['resolveWithoutHunterRevenge']>;
    hunterDecisions: Record<string, { targetTelegramId: string | null } | null>;
  }): { room: RoomState; result: NightResolutionResult } {
    const { room, stepOneResult, hunterDecisions } = params;
    const deathQueue = new DeathQueue();

    const { resolved: depth0Resolved } = deathQueue.resolveOriginalDeaths(
      stepOneResult.depth0Deaths,
      room.players,
      room.settings.hunterTriggerCauses as DeathCause[],
    );

    const decisionsWithHunterId: Record<
      string,
      { hunterTelegramId: string; targetTelegramId: string | null } | null
    > = {};
    for (const [hunterId, decision] of Object.entries(params.hunterDecisions)) {
      decisionsWithHunterId[hunterId] = decision
        ? { hunterTelegramId: hunterId, targetTelegramId: decision.targetTelegramId }
        : null;
    }

    const resolvedDeaths = deathQueue.applyHunterDecisions(
      depth0Resolved,
      room.players,
      decisionsWithHunterId,
    );

    let updatedPlayers: Record<string, PlayerState> = { ...room.players };
    for (const death of resolvedDeaths) {
      const player = updatedPlayers[death.telegramId];
      if (!player || !player.alive) continue;
      updatedPlayers[death.telegramId] = killPlayer(player, death.cause, room.currentRound);
    }

    updatedPlayers = Object.fromEntries(
      Object.entries(updatedPlayers).map(([id, p]) => [id, resetNightFlags(p)]),
    );

    const updatedRoom: RoomState = {
      ...room,
      players: updatedPlayers,
      witchPotions: stepOneResult.witchPotions,
      lastProtectedByBodyguard: stepOneResult.lastProtectedByBodyguard,
    };

    const result: NightResolutionResult = {
      deaths: resolvedDeaths.map((d) => ({ telegramId: d.telegramId, cause: d.cause })),
      seerResults: stepOneResult.seerResults,
      rejectedActions: stepOneResult.rejectedActions,
    };

    void hunterDecisions; // consumed via decisionsWithHunterId above
    return { room: updatedRoom, result };
  }

  /**
   * Convenience wrapper combining both steps for callers (unit tests, or
   * any flow where every Hunter decision is already known synchronously).
   * Real Telegram flows should call resolveWithoutHunterRevenge, await each
   * Hunter's real response, then call applyHunterRevengeAndFinalize.
   */
  resolve(params: {
    room: RoomState;
    submissions: NightActionSubmission[];
    getHunterDecision: (
      hunterTelegramId: string,
    ) => { targetTelegramId: string | null } | null;
  }): { room: RoomState; result: NightResolutionResult } {
    const stepOneResult = this.resolveWithoutHunterRevenge({
      room: params.room,
      submissions: params.submissions,
    });
    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of stepOneResult.pendingHunterTelegramIds) {
      hunterDecisions[hunterId] = params.getHunterDecision(hunterId);
    }
    return this.applyHunterRevengeAndFinalize({
      room: params.room,
      stepOneResult,
      hunterDecisions,
    });
  }

  /**
   * Tallies werewolf kill votes and returns the target with the most votes.
   * Ties are broken uniformly at random via the injected RandomPort, so
   * outcome fairness is deterministically testable with a seeded fake.
   * Returns null if no werewolf submitted a valid (non-null) target.
   */
  private resolveWerewolfVote(actions: NightActionSubmission[]): string | null {
    const tally: Record<string, number> = {};
    for (const action of actions) {
      if (!action.targetTelegramId) continue;
      tally[action.targetTelegramId] = (tally[action.targetTelegramId] ?? 0) + 1;
    }
    const entries = Object.entries(tally);
    if (entries.length === 0) return null;

    const maxVotes = Math.max(...entries.map(([, count]) => count));
    const topTargets = entries
      .filter(([, count]) => count === maxVotes)
      .map(([id]) => id);
    return this.random.pick(topTargets);
  }
}
