require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
(async () => {
  await redis.connect();
  const events = await redis.xrange('bull:night-action-timeout:events', '-', '+');
  console.log(JSON.stringify({ now: Date.now(), events }, null, 2));
  process.exit(0);
})().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exit(1); });
