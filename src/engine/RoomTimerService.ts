import { SchedulerPort } from './ports/SchedulerPort';
import { StoragePort } from './ports/StoragePort';
import { ClockPort } from './ports/ClockPort';

/** Job type identifiers for each timed phase, scheduled via SchedulerPort. */
export enum TimerJobType {
  NIGHT_ACTION_TIMEOUT = 'night-action-timeout',
  DISCUSSION_TIMEOUT = 'discussion-timeout',
  VOTING_TIMEOUT = 'voting-timeout',
}

/**
 * Coordinates timed-phase deadlines for a room: schedules a BullMQ job (via
 * SchedulerPort) to fire when a phase's timer expires, while also persisting
 * the deadline's absolute epoch-ms timestamp via StoragePort (Suggestion #6).
 *
 * Restart-resume design: BullMQ itself already re-delivers a scheduled job
 * after a process restart (its delayed-job state lives in Redis, not in this
 * process's memory). The ADDITIONAL persisted deadline
 * (`StoragePort.setTimerDeadline`) serves a different purpose: it lets the
 * Telegram layer answer "how much time is left in this phase?" for UI
 * purposes (e.g. showing a live countdown) without needing to inspect BullMQ
 * internals, and it lets `findOverdueRooms` (called once at bot startup)
 * detect the edge case where a deadline has ALREADY PASSED while the process
 * was down -- in that case the caller can resolve the phase immediately
 * instead of waiting for BullMQ to redeliver a job whose delay is already
 * satisfied (BullMQ will still fire it correctly, but this gives an
 * explicit, immediate path that doesn't depend on Worker polling cadence for
 * an already-overdue phase).
 */
export class RoomTimerService {
  constructor(
    private readonly scheduler: SchedulerPort,
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Schedules a phase timeout `delayMs` from now, persists the resulting
   * absolute deadline, and returns the BullMQ job id (callers may want to
   * cancel it early if the phase resolves before the timer fires, e.g. all
   * players submitted before the deadline).
   */
  async scheduleTimeout(params: {
    jobType: TimerJobType;
    roomId: string;
    delayMs: number;
    payload?: Record<string, unknown>;
  }): Promise<string> {
    const deadline = this.clock.now() + params.delayMs;
    await this.storage.setTimerDeadline(params.roomId, deadline);
    const handle = await this.scheduler.scheduleOnce({
      jobType: params.jobType,
      roomId: params.roomId,
      payload: params.payload ?? {},
      delayMs: params.delayMs,
    });
    return handle.jobId;
  }

  /** Cancels a previously scheduled timeout and clears its persisted deadline
   * (e.g. all players already submitted before the timer expired). */
  async cancelTimeout(roomId: string, jobId: string): Promise<void> {
    await this.scheduler.cancel(jobId);
    await this.storage.clearTimerDeadline(roomId);
  }

  /** Returns how many milliseconds remain until the room's current phase
   * deadline, or null if no timer is currently active for this room.
   * Negative values indicate the deadline has already passed (can happen
   * briefly around a restart, before findOverdueRooms handling runs). */
  async getRemainingMs(roomId: string): Promise<number | null> {
    const deadline = await this.storage.getTimerDeadline(roomId);
    if (deadline === null) return null;
    return deadline - this.clock.now();
  }

  /**
   * Registers the handler invoked when a phase timeout fires. Thin
   * pass-through to SchedulerPort.onJobDue, kept on this class so all
   * timer-related wiring for the engine lives in one place rather than
   * spreading SchedulerPort usage across the Telegram bootstrap code.
   */
  onTimeout(jobType: TimerJobType, handler: (roomId: string) => Promise<void>): void {
    this.scheduler.onJobDue(jobType, async ({ roomId }) => {
      await handler(roomId);
    });
  }

  /**
   * Called once at bot startup (Suggestion #6) to detect rooms whose timer
   * deadline already elapsed while the process was down, so their phase can
   * be resolved immediately rather than waiting on BullMQ's own redelivery
   * timing. Returns the list of roomIds that are overdue; the caller
   * (bootstrap code) is responsible for invoking the appropriate resolution
   * logic (e.g. NightActionService.resolveNight) for each.
   */
  async findOverdueRooms(roomIds: string[]): Promise<string[]> {
    const now = this.clock.now();
    const overdue: string[] = [];
    for (const roomId of roomIds) {
      const deadline = await this.storage.getTimerDeadline(roomId);
      if (deadline !== null && deadline <= now) {
        overdue.push(roomId);
      }
    }
    return overdue;
  }
}
