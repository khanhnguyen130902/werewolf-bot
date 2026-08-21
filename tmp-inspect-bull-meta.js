require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
(async () => {
  await redis.connect();
  const queues = ['night-action-timeout', 'witch-action-timeout', 'discussion-timeout', 'voting-timeout'];
  const result = {};
  for (const queue of queues) {
    const prefix = `bull:${queue}`;
    const keyNames = ['id', 'meta', 'events', 'completed', 'failed', 'wait', 'active', 'delayed'];
    const values = {};
    for (const name of keyNames) {
      const key = `${prefix}:${name}`;
      const type = await redis.type(key);
      if (type === 'string') values[name] = await redis.get(key);
      else if (type === 'hash') values[name] = await redis.hgetall(key);
      else if (type === 'list') values[name] = await redis.lrange(key, 0, -1);
      else if (type === 'zset') values[name] = await redis.zrange(key, 0, -1, 'WITHSCORES');
      else if (type === 'stream') values[name] = { type, length: await redis.xlen(key) };
      else if (type !== 'none') values[name] = { type };
    }
    result[queue] = values;
  }
  console.log(JSON.stringify({ now: Date.now(), result }, null, 2));
  process.exit(0);
})().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exit(1); });
