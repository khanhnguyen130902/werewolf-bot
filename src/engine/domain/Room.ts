import { GameState, RoomStatus, TimeoutBehavior } from './enums';
import { PlayerState } from './Player';

/**
 * Game rule configuration for a Room. All values are configurable per SRS
 * section 6/7/11 requirements ("Có cấu hình...", "Có khả năng thay đổi thứ tự
 * bằng cấu hình Game Engine") — nothing here is hard-coded in the engine logic.
 */
export interface GameSettings {
  /** Minimum players required to start a match (Suggestion #3). */
  minPlayers: number;
  /** Maximum players allowed to join a room (Suggestion #3). */
  maxPlayers: number;

  /** Role distribution strategy id, resolved via RoleDistributionRegistry (Suggestion #4). */
  roleDistributionStrategy: string;

  /**
   * Special roles (Seer/Bodyguard/Hunter/Witch as RoleId strings) the host
   * has opted into for this match. Villager always fills remaining slots;
   * Werewolf count is always computed by the distribution strategy. Business
   * rule (confirmed with product owner): special roles are NOT auto-filled —
   * only the ones listed here are used, giving the host explicit control.
   */
  enabledRoles: string[];

  /** Seer inspection reveals exact Role instead of just Team. */
  seerRevealsExactRole: boolean;

  /** Bodyguard may protect the same target on consecutive nights. */
  bodyguardAllowConsecutiveProtect: boolean;
  /** Bodyguard may protect themselves. */
  bodyguardAllowSelfProtect: boolean;

  /** Witch may use both save and poison potion in the same night. */
  witchAllowDualPotion: boolean;

  /** Which death causes trigger the Hunter's revenge shot. */
  hunterTriggerCauses: string[];

  /** Ordered list of NightActionType strings defining night resolution order (SRS section 7). */
  nightActionOrder: string[];

  /** Behavior when a timed action is not submitted in time (Suggestion #10). */
  defaultTimeoutBehavior: TimeoutBehavior;

  /** Duration (seconds) for each timed phase. */
  timers: {
    nightActionSeconds: number;
    discussionSeconds: number;
    votingSeconds: number;
  };
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  minPlayers: 3,
  maxPlayers: 20,
  roleDistributionStrategy: 'default-phase1',
  enabledRoles: ['SEER', 'BODYGUARD', 'HUNTER', 'WITCH'],
  seerRevealsExactRole: false,
  bodyguardAllowConsecutiveProtect: true,
  bodyguardAllowSelfProtect: false,
  witchAllowDualPotion: true,
  hunterTriggerCauses: ['WEREWOLF_KILL', 'VOTE_EXECUTION', 'WITCH_POISON'],
  nightActionOrder: [
    'WEREWOLF_VOTE_KILL',
    'BODYGUARD_PROTECT',
    'SEER_INSPECT',
    'WITCH_SAVE',
    'WITCH_POISON',
  ],
  defaultTimeoutBehavior: TimeoutBehavior.SKIP,
  timers: {
    nightActionSeconds: 60,
    discussionSeconds: 300,
    votingSeconds: 60,
  },
};

export interface RoomState {
  id: string;
  hostTelegramId: string;
  status: RoomStatus;
  gameState: GameState;
  players: Record<string, PlayerState>; // keyed by telegramId
  settings: GameSettings;
  currentRound: number;
  /** Optimistic-locking version counter (Suggestion #1). Incremented on every write. */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Telegram chat id of the group this room is bound to. */
  chatId: string;
  /**
   * Identifies the current match for event-log correlation (SRS section 9:
   * `match:{id}`, `logs:{matchId}`). Null while the room is WAITING (no match
   * has started yet); assigned fresh each time a game STARTs, so a room that
   * plays multiple matches back-to-back gets a clean log per match.
   */
  matchId: string | null;
  /**
   * Witch's per-match potion inventory (save/poison), null until the Witch
   * role is actually in play for the current match. Kept at Room level
   * rather than nested under the Witch player because it must survive even
   * after the Witch player has died (a used/unused potion state has no
   * further gameplay relevance once the witch is dead, but keeping it here
   * avoids a special case in serialization).
   */
  witchPotions: { saveUsed: boolean; poisonUsed: boolean } | null;
  /**
   * Tracks each Bodyguard's previous-night protection target, to enforce the
   * bodyguardAllowConsecutiveProtect setting (SRS section 6). Keyed by the
   * bodyguard's telegramId; value is the telegramId they protected last
   * night, or null if they didn't protect anyone / it's the first night.
   */
  lastProtectedByBodyguard: Record<string, string | null>;
  /**
   * Night actions submitted so far for the CURRENT night, awaiting
   * resolution at end of night. Persisted on RoomState (not just in-memory)
   * so a bot restart mid-night (Suggestion #6) does not lose already-submitted
   * actions — players would otherwise have to resubmit even though their
   * action was already accepted.
   */
  pendingNightActions: Array<{
    actionId: string;
    actorTelegramId: string;
    actionType: string;
    targetTelegramId: string | null;
    round: number;
  }>;
}

export class RoomFactory {
  static create(params: {
    id: string;
    hostTelegramId: string;
    chatId: string;
    settingsOverride?: Partial<GameSettings>;
    now: number;
  }): RoomState {
    return {
      id: params.id,
      hostTelegramId: params.hostTelegramId,
      status: RoomStatus.OPEN,
      gameState: GameState.WAITING,
      players: {},
      settings: { ...DEFAULT_GAME_SETTINGS, ...params.settingsOverride },
      currentRound: 0,
      version: 0,
      createdAt: params.now,
      updatedAt: params.now,
      chatId: params.chatId,
      matchId: null,
      witchPotions: null,
      lastProtectedByBodyguard: {},
      pendingNightActions: [],
    };
  }
}
