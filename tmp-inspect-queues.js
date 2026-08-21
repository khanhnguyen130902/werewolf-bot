require('dotenv').config();
const Redis = require('ioredis');

async function main() {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  await redis.connect();
  const roomId = '-1004377456417';
  const keys = [];
  const stream = redis.scanStream({ match: 'bull:*', count: 200 });
  stream.on('data', (batch) => keys.push(...batch));
  await new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const candidateQueues = [...new Set(keys.map((key) => key.split(':')[1]).filter(Boolean))].sort();
  const details = [];
  for (const queue of candidateQueues) {
    const delayed = await redis.zrange(`bull:${queue}:delayed`, 0, -1, 'WITHSCORES');
    const waiting = await redis.lrange(`bull:${queue}:wait`, 0, -1);
    const active = await redis.lrange(`bull:${queue}:active`, 0, -1);
    const matches = [...delayed, ...waiting, ...active].filter((v) => String(v).includes(roomId));
    if (matches.length > 0 || delayed.length > 0 || waiting.length > 0 || active.length > 0) {
      details.push({ queue, delayedCount: delayed.length / 2, waitingCount: waiting.length, activeCount: active.length, roomMatches: matches });
    }
  }
  const deadline = await redis.get(`timer:${roomId}`);
  console.log(JSON.stringify({ roomId, timerDeadline: deadline, bullQueues: details }, null, 2));
  await redis.quit();
}

main().catch((err) => {
  console.error(JSON.stringify({ name: err?.name, message: err?.message }));
  process.exitCode = 1;
});
