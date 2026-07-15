import { Redis } from 'ioredis';
import { BullMqSchedulerPort } from '../../src/infrastructure/scheduler/BullMqSchedulerPort';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

let redis: Redis;
let redisAvailable = true;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    redisAvailable = false;
  }
});

afterAll(async () => {
  if (redisAvailable) {
    await redis.quit();
  }
});

beforeEach(async () => {
  if (redisAvailable) {
    await redis.flushall();
  }
});

describe('BullMqSchedulerPort (integration)', () => {
  it('reports whether Redis is reachable for this test run', () => {
    if (!redisAvailable) {
      // eslint-disable-next-line no-console
      console.warn(
        `Redis not reachable at ${REDIS_URL} -- BullMqSchedulerPort integration tests will no-op.`,
      );
    }
    expect(true).toBe(true);
  });

  it('fires a scheduled job with its payload after the delay elapses', async () => {
    if (!redisAvailable) return;
    const scheduler = new BullMqSchedulerPort({ host: '127.0.0.1', port: 6379 });

    const received: Array<{ roomId: string; payload: Record<string, unknown> }> = [];
    scheduler.onJobDue('test-job-fire', async (data) => {
      received.push(data);
    });

    await scheduler.scheduleOnce({
      jobType: 'test-job-fire',
      roomId: 'room1',
      payload: { foo: 'bar' },
      delayMs: 200,
    });

    const deadline = Date.now() + 5000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ roomId: 'room1', payload: { foo: 'bar' } });

    await scheduler.shutdown();
  }, 10000);

  it('cancel() prevents a scheduled job from firing', async () => {
    if (!redisAvailable) return;
    const scheduler = new BullMqSchedulerPort({ host: '127.0.0.1', port: 6379 });

    const received: string[] = [];
    scheduler.onJobDue('test-job-cancel', async (data) => {
      received.push(data.roomId);
    });

    const handle = await scheduler.scheduleOnce({
      jobType: 'test-job-cancel',
      roomId: 'room1',
      payload: {},
      delayMs: 300,
    });
    await scheduler.cancel(handle.jobId);

    await new Promise((r) => setTimeout(r, 600));
    expect(received).toHaveLength(0);

    await scheduler.shutdown();
  }, 10000);

  it('RESTART RESILIENCE: a job scheduled by one scheduler instance is delivered by a fresh instance (simulating a process restart)', async () => {
    if (!redisAvailable) return;

    const schedulerA = new BullMqSchedulerPort({ host: '127.0.0.1', port: 6379 });
    await schedulerA.scheduleOnce({
      jobType: 'test-job-restart',
      roomId: 'room-restart',
      payload: { survivedRestart: true },
      delayMs: 200,
    });
    await schedulerA.shutdown();

    const schedulerB = new BullMqSchedulerPort({ host: '127.0.0.1', port: 6379 });
    const received: Array<{ roomId: string; payload: Record<string, unknown> }> = [];
    schedulerB.onJobDue('test-job-restart', async (data) => {
      received.push(data);
    });

    const deadline = Date.now() + 5000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      roomId: 'room-restart',
      payload: { survivedRestart: true },
    });

    await schedulerB.shutdown();
  }, 10000);
});
