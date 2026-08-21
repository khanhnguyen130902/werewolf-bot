require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
(async () => {
  await redis.connect();
  const keys = (await redis.keys('bull:night-action-timeout:*')).sort();
  const result = [];
  for (const key of keys) {
    const type = await redis.type(key);
    let value = null;
    if (type === 'string') value = await redis.get(key);
    if (type === 'hash') value = await redis.hgetall(key);
    if (type === 'list') value = await redis.lrange(key, 0, -1);
    if (type === 'zset') value = await redis.zrange(key, 0, -1, 'WITHSCORES');
    if (type === 'stream') value = { length: await redis.xlen(key) };
    result.push({ key, type, ttl: await redis.ttl(key), value });
  }
  console.log(JSON.stringify({ now: Date.now(), result }, null, 2));
  process.exit(0);
})().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exit(1); });
