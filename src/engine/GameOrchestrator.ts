import { RoomService } from './RoomService';
import { GameService } from './GameService';
import { NightActionService } from './NightActionService';
import { DayService } from './DayService';
import { RoomTimerService, TimerJobType } from './RoomTimerService';
import { RoomState } from './domain/Room';
import { GameState } from './domain/enums';

/**
 * Callback the Telegram layer supplies so the orchestrator can prompt a
 * Hunter and await their real response (button click or timeout), without
 * this class (or NightActionService/DayService underneath it) importing
 * Telegraf. This is the async boundary the Phase 6 redesign of
 * DeathQueue/NightResolver/NightActionService/DayService was built for.
 */
export type HunterPromptFn = (
  roomId: string,
  hunterTelegramId: string,
) => Promise<{ targetTelegramId: string | null }>;

/**
 * Coordinates a full round of gameplay across RoomService, GameService,
 * NightActionService, DayService, and RoomTimerService. This is the
 * top-level engine-side entry point the Telegram layer calls into -- it
 * still contains ZERO Telegraf imports, preserving the "Engine độc lập
 * platform" requirement even for this final orchestration layer. Only the
 * `HunterPromptFn` callback crosses the boundary, and it's defined purely in
 * terms of telegramIds/strings, not Telegraf types.
 */
export class GameOrchestrator {
  constructor(
    public readonly roomService: RoomService,
    public readonly gameService: GameService,
    public readonly nightActionService: NightActionService,
    public readonly dayService: DayService,
    public readonly timerService: RoomTimerService,
  ) {}

  /**
   * Resolves the current night: runs the night-action pipeline, prompts any
   * Hunter(s) who died via `promptHunter` (awaiting each in turn), then
   * finalizes deaths and transitions the state machine. Returns the same
   * shape as NightActionService.resolveNight for the caller's convenience.
   */
  async resolveNight(params: { roomId: string; promptHunter: HunterPromptFn }) {
    const { stepOneResult } = await this.nightActionService.prepareNightResolution(
      params.roomId,
    );

    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of stepOneResult.pendingHunterTelegramIds) {
      hunterDecisions[hunterId] = await params.promptHunter(params.roomId, hunterId);
    }

    return this.nightActionService.finalizeNightResolution({
      roomId: params.roomId,
      stepOneResult,
      hunterDecisions,
    });
  }

  /**
   * Resolves the current day's execution vote: tallies votes, prompts any
   * Hunter who was executed via `promptHunter`, then finalizes deaths and
   * transitions the state machine.
   */
  async resolveExecution(params: { roomId: string; promptHunter: HunterPromptFn }) {
    const prepared = await this.dayService.prepareExecutionResolution(params.roomId);

    const hunterDecisions: Record<string, { targetTelegramId: string | null } | null> = {};
    for (const hunterId of prepared.pendingHunterTelegramIds) {
      hunterDecisions[hunterId] = await params.promptHunter(params.roomId, hunterId);
    }

    return this.dayService.finalizeExecutionResolution({
      roomId: params.roomId,
      executedTelegramId: prepared.executedTelegramId,
      voteCounts: prepared.voteCounts,
      depth0Deaths: prepared.depth0Deaths,
      hunterDecisions,
    });
  }

  /**
   * Schedules the appropriate timer for whatever timed phase `room` is
   * currently in (NIGHT/FIRST_NIGHT, DISCUSSION, or VOTING), using the
   * duration from `room.settings.timers`. No-ops for phases with no timer
   * (WAITING, STARTING, DAY, EXECUTION, CHECK_WIN, GAME_OVER).
   */
  async scheduleCurrentPhaseTimer(room: RoomState): Promise<string | null> {
    const timers = room.settings.timers;
    switch (room.gameState) {
      case GameState.FIRST_NIGHT:
      case GameState.NIGHT:
        return this.timerService.scheduleTimeout({
          jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
          roomId: room.id,
          delayMs: timers.nightActionSeconds * 1000,
        });
      case GameState.DISCUSSION:
        return this.timerService.scheduleTimeout({
          jobType: TimerJobType.DISCUSSION_TIMEOUT,
          roomId: room.id,
          delayMs: timers.discussionSeconds * 1000,
        });
      case GameState.VOTING:
        return this.timerService.scheduleTimeout({
          jobType: TimerJobType.VOTING_TIMEOUT,
          roomId: room.id,
          delayMs: timers.votingSeconds * 1000,
        });
      default:
        return null;
    }
  }

  /** Cancels any timer currently scheduled for `roomId` (e.g. because every
   * player already acted before the timer fired). Safe to call even if no
   * timer is active. */
  async cancelCurrentPhaseTimer(roomId: string, jobId: string | null): Promise<void> {
    if (!jobId) return;
    await this.timerService.cancelTimeout(roomId, jobId);
  }

  /**
   * Returns true if every living player who has a night action to perform
   * this round has already submitted one, meaning the night can resolve
   * immediately without waiting for the timer. Used to let the Telegram
   * layer cancel the timer early and advance the game as soon as everyone
   * has acted, instead of always waiting the full configured duration.
   */
  async allNightActionsSubmitted(roomId: string): Promise<boolean> {
    const room = await this.roomService.getRoom(roomId);
    if (!room) return false;

    const alivePlayersWithNightAction = Object.values(room.players).filter(
      (p) => p.alive && p.role && this.roleHasNightAction(p.role),
    );

    const actedTelegramIds = new Set(room.pendingNightActions.map((a) => a.actorTelegramId));

    return alivePlayersWithNightAction.every((p) => actedTelegramIds.has(p.telegramId));
  }

  private roleHasNightAction(roleId: string): boolean {
    // Villager and Hunter (whose only action is the death-triggered revenge
    // shot, not a regular per-night prompt) have no regular night action.
    return (
      roleId === 'WEREWOLF' || roleId === 'SEER' || roleId === 'BODYGUARD' || roleId === 'WITCH'
    );
  }
}
