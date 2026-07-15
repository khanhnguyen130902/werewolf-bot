import { RoomTimerService, TimerJobType } from '../../src/engine/RoomTimerService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { SchedulerPort, ScheduledJobHandle } from '../../src/engine/ports/SchedulerPort';

class FakeClock implements ClockPort {
  private t: number;
  constructor(t = 1000) {
    this.t = t;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

class FakeScheduler implements SchedulerPort {
  public scheduled: Array<{
    jobId: string;
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }> = [];
  public cancelled: string[] = [];
  private handlers = new Map<
    string,
    (payload: { roomId: string; payload: Record<string, unknown> }) => Promise<void>
  >();
  private nextId = 1;

  async scheduleOnce(params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle> {
    const jobId = `job-${this.nextId++}`;
    this.scheduled.push({ jobId, ...params });
    return { jobId };
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
  }

  onJobDue(
    jobType: string,
    handler: (payload: { roomId: string; payload: Record<string, unknown> }) => Promise<void>,
  ): void {
    this.handlers.set(jobType, handler);
  }

  async shutdown(): Promise<void> {
    // no-op for the fake
  }

  async fire(jobType: string, roomId: string, payload: Record<string, unknown> = {}) {
    const handler = this.handlers.get(jobType);
    if (!handler) throw new Error(`No handler registered for ${jobType}`);
    await handler({ roomId, payload });
  }
}

describe('RoomTimerService', () => {
  function setup() {
    const storage = new InMemoryStorageAdapter();
    const clock = new FakeClock();
    const scheduler = new FakeScheduler();
    const service = new RoomTimerService(scheduler, storage, clock);
    return { storage, clock, scheduler, service };
  }

  it('scheduleTimeout schedules a job and persists the absolute deadline', async () => {
    const { storage, clock, scheduler, service } = setup();
    const jobId = await service.scheduleTimeout({
      jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
      roomId: 'room1',
      delayMs: 45000,
    });

    expect(jobId).toBe('job-1');
    expect(scheduler.scheduled).toHaveLength(1);
    expect(scheduler.scheduled[0].delayMs).toBe(45000);

    const deadline = await storage.getTimerDeadline('room1');
    expect(deadline).toBe(clock.now() + 45000);
  });

  it('getRemainingMs reflects time left until the deadline', async () => {
    const { clock, service } = setup();
    await service.scheduleTimeout({
      jobType: TimerJobType.VOTING_TIMEOUT,
      roomId: 'room1',
      delayMs: 10000,
    });

    const remainingNow = await service.getRemainingMs('room1');
    expect(remainingNow).toBe(10000);

    clock.advance(4000);
    const remainingLater = await service.getRemainingMs('room1');
    expect(remainingLater).toBe(6000);
  });

  it('getRemainingMs returns null when no timer is active', async () => {
    const { service } = setup();
    expect(await service.getRemainingMs('no-timer-room')).toBeNull();
  });

  it('cancelTimeout cancels the scheduler job and clears the persisted deadline', async () => {
    const { storage, scheduler, service } = setup();
    const jobId = await service.scheduleTimeout({
      jobType: TimerJobType.DISCUSSION_TIMEOUT,
      roomId: 'room1',
      delayMs: 90000,
    });

    await service.cancelTimeout('room1', jobId);

    expect(scheduler.cancelled).toEqual([jobId]);
    expect(await storage.getTimerDeadline('room1')).toBeNull();
  });

  it('onTimeout registers a handler that fires when the scheduler delivers the job', async () => {
    const { scheduler, service } = setup();
    const received: string[] = [];
    service.onTimeout(TimerJobType.NIGHT_ACTION_TIMEOUT, async (roomId) => {
      received.push(roomId);
    });

    await scheduler.fire(TimerJobType.NIGHT_ACTION_TIMEOUT, 'room1');
    expect(received).toEqual(['room1']);
  });

  it('findOverdueRooms identifies rooms whose deadline has already passed', async () => {
    const { clock, service } = setup();
    await service.scheduleTimeout({
      jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
      roomId: 'room-overdue',
      delayMs: 1000,
    });
    await service.scheduleTimeout({
      jobType: TimerJobType.NIGHT_ACTION_TIMEOUT,
      roomId: 'room-not-yet',
      delayMs: 100000,
    });

    clock.advance(5000);

    const overdue = await service.findOverdueRooms(['room-overdue', 'room-not-yet']);
    expect(overdue).toEqual(['room-overdue']);
  });

  it('findOverdueRooms ignores rooms with no active timer at all', async () => {
    const { service } = setup();
    const overdue = await service.findOverdueRooms(['room-with-no-timer']);
    expect(overdue).toEqual([]);
  });
});
