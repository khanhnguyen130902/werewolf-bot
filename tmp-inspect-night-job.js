require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
(async () => {
  await redis.connect();
  const key = 'bull:night-action-timeout:1';
  const type = await redis.type(key);
  const ttl = await redis.ttl(key);
  const hash = type === 'hash' ? await redis.hgetall(key) : null;
  const delayedType = await redis.type('bull:night-action-timeout:delayed');
  const delayed = delayedType === 'zset' ? await redis.zrange('bull:night-action-timeout:delayed', 0, -1, 'WITHSCORES') : null;
  const waitType = await redis.type('bull:night-action-timeout:wait');
  const wait = waitType === 'list' ? await redis.lrange('bull:night-action-timeout:wait', 0, -1) : null;
  console.log(JSON.stringify({ key, type, ttl, hash, delayedType, delayed, waitType, wait }, null, 2));
  process.exit(0);
})().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exit(1); });
