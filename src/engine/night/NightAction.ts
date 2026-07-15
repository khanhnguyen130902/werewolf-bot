import { NightActionType } from '../domain/enums';

/**
 * A single night action submitted by a player, as received from the
 * Telegram layer (or any future front-end). This is intentionally decoupled
 * from PlayerState — a player may submit zero, one, or (for Witch) two
 * actions in the same night, so actions are modeled as discrete events
 * rather than a single field on the player.
 *
 * `actionId` implements the idempotency guard (Suggestion #2): the caller
 * (Telegram command handler) generates a fresh uuid per button press: if the
 * same press is retried (e.g. due to a network blip causing a double-tap),
 * the resolver's storage-backed dedup check rejects the duplicate before it
 * can be counted twice.
 */
export interface NightActionSubmission {
  actionId: string;
  actorTelegramId: string;
  actionType: NightActionType;
  targetTelegramId: string | null;
  round: number;
}

/**
 * Result of resolving one night's worth of actions. Consumed by GameService
 * to update RoomState and by the Telegram presenter layer to render
 * appropriate messages (deaths, Seer's private result, etc).
 */
export interface NightResolutionResult {
  /** telegramIds of players who died as a result of this night, in the order
   * they were resolved (matters for Hunter revenge-shot chaining). */
  deaths: Array<{ telegramId: string; cause: string }>;
  /** Seer inspection results to deliver privately: telegramId of the Seer -> result. */
  seerResults: Array<{
    seerTelegramId: string;
    targetTelegramId: string;
    revealedTeam: string;
    revealedRole: string | null; // present only if seerRevealsExactRole is on
  }>;
  /** Whether each submitted action was accepted, and why if rejected (for
   * feedback to the player, e.g. "no potion left"). */
  rejectedActions: Array<{ actionId: string; reason: string }>;
}
