/**
 * Abstraction for scheduling a one-shot deferred callback tied to a room's
 * timed phase (night-action timeout, discussion timer, voting timeout).
 *
 * Kept as an engine-facing port (mirroring StoragePort/ClockPort/RandomPort)
 * so the Game Engine's timer-dependent logic never imports BullMQ directly --
 * only the Telegram-layer bootstrap code (Phase 6) wires a concrete
 * SchedulerPort implementation in. This preserves the "Engine độc lập với
 * platform" requirement even for scheduling, not just storage.
 *
 * Why BullMQ instead of raw setTimeout (product owner decision): BullMQ jobs
 * are persisted in Redis, so a scheduled deadline survives a bot process
 * restart -- the job simply resumes on whichever process is running when it
 * becomes due, rather than being silently lost the way an in-memory
 * setTimeout would be (Suggestion #6: resume after restart).
 */
export interface ScheduledJobHandle {
  jobId: string;
}

export interface SchedulerPort {
  /**
   * Schedules `payload` to be delivered to the registered handler for
   * `jobType` after `delayMs`. Returns a handle that can be used to cancel
   * the job if the phase ends early (e.g. all players submitted their night
   * action before the timer expired).
   */
  scheduleOnce(params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle>;

  /** Cancels a previously scheduled job, if it hasn't fired yet. Safe to
   * call even if the job already fired or was already cancelled. */
  cancel(jobId: string): Promise<void>;

  /**
   * Registers the function invoked when a scheduled job of `jobType` fires.
   * In BullMQ terms this sets up a Worker for that job type's queue.
   */
  onJobDue(
    jobType: string,
    handler: (payload: { roomId: string; payload: Record<string, unknown> }) => Promise<void>,
  ): void;

  /** Gracefully shuts down all underlying workers/connections. */
  shutdown(): Promise<void>;
}
