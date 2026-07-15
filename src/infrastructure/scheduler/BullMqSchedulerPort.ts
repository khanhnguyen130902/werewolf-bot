import { Queue, Worker, ConnectionOptions } from 'bullmq';
import { SchedulerPort, ScheduledJobHandle } from '../../engine/ports/SchedulerPort';

/**
 * Production SchedulerPort implementation backed by BullMQ. Each distinct
 * `jobType` (e.g. "night-timeout", "discussion-timeout", "voting-timeout")
 * gets its own BullMQ Queue + Worker pair, created lazily on first use.
 *
 * Restart resilience (Suggestion #6): BullMQ persists every scheduled job's
 * due-time in Redis via its own internal delayed-job zset. If this Node
 * process crashes or is redeployed, any BullMQ Worker started afterward
 * against the SAME Redis instance will pick up and fire jobs whose delay has
 * already elapsed (or is still pending) without any extra bookkeeping code
 * in this class -- this is precisely why BullMQ was chosen over a bare
 * `setTimeout`-based scheduler, which would lose all pending timers on
 * restart.
 */
export class BullMqSchedulerPort implements SchedulerPort {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();

  constructor(private readonly connection: ConnectionOptions) {}

  private getOrCreateQueue(jobType: string): Queue {
    let queue = this.queues.get(jobType);
    if (!queue) {
      queue = new Queue(jobType, { connection: this.connection });
      this.queues.set(jobType, queue);
    }
    return queue;
  }

  async scheduleOnce(params: {
    jobType: string;
    roomId: string;
    payload: Record<string, unknown>;
    delayMs: number;
  }): Promise<ScheduledJobHandle> {
    const queue = this.getOrCreateQueue(params.jobType);
    const job = await queue.add(
      params.jobType,
      { roomId: params.roomId, payload: params.payload },
      {
        delay: params.delayMs,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );
    return { jobId: job.id! };
  }

  async cancel(jobId: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
        }
        return;
      }
    }
  }

  onJobDue(
    jobType: string,
    handler: (payload: { roomId: string; payload: Record<string, unknown> }) => Promise<void>,
  ): void {
    if (this.workers.has(jobType)) {
      throw new Error(`A worker for jobType "${jobType}" is already registered`);
    }
    const worker = new Worker(
      jobType,
      async (job) => {
        await handler(job.data as { roomId: string; payload: Record<string, unknown> });
      },
      { connection: this.connection },
    );
    this.workers.set(jobType, worker);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
