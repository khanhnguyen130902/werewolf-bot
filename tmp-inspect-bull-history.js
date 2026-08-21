require('dotenv').config();
const Redis = require('ioredis');

async function main() {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  await redis.connect();
  const queues = ['night-action-timeout', 'witch-action-timeout', 'discussion-timeout', 'voting-timeout'];
  const result = {};
  for (const queue of queues) {
    const prefix = `bull:${queue}`;
    const completedIds = await redis.zrange(`${prefix}:completed`, -20, -1);
    const failedIds = await redis.zrange(`${prefix}:failed`, -20, -1);
    const delayed = await redis.zrange(`${prefix}:delayed`, 0, -1, 'WITHSCORES');
    const waiting = await redis.lrange(`${prefix}:wait`, 0, -1);
    const active = await redis.lrange(`${prefix}:active`, 0, -1);
    const jobs = {};
    for (const id of [...completedIds, ...failedIds, ...waiting, ...active]) {
      const raw = await redis.get(`${prefix}:${id}`);
      if (raw) {
        const job = JSON.parse(raw);
        jobs[id] = { name: job.name, data: job.data, timestamp: job.timestamp, delay: job.delay, attemptsMade: job.attemptsMade, failedReason: job.failedReason };
      }
    }
    result[queue] = { completedIds, failedIds, delayed, waiting, active, jobs };
  }
  console.log(JSON.stringify({ now: Date.now(), result }, null, 2));
  await redis.quit();
}
main().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exitCode = 1; });
