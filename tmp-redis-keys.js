require('dotenv').config();
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 1 });
(async () => {
  await redis.connect();
  const keys = await redis.keys('bull:*');
  const roomKeys = await redis.keys('room:-1004377456417');
  const timerKeys = await redis.keys('timer:-1004377456417');
  console.log(JSON.stringify({ keyCount: keys.length, keys: keys.slice(0, 200), roomKeys, timerKeys }, null, 2));
  process.exit(0);
})().catch((err) => { console.error(JSON.stringify({ name: err?.name, message: err?.message })); process.exit(1); });
