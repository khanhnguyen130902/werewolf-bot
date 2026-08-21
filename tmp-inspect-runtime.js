require('dotenv').config();
const Redis = require('ioredis');

async function main() {
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  await redis.connect();
  const roomIds = await redis.smembers('rooms:active');
  const rows = [];
  for (const roomId of roomIds) {
    const raw = await redis.get(`room:${roomId}`);
    if (!raw) continue;
    const room = JSON.parse(raw);
    const deadlineRaw = await redis.get(`timer:${roomId}`);
    const players = Object.values(room.players || {});
    rows.push({
      roomId,
      gameState: room.gameState,
      status: room.status,
      currentRound: room.currentRound,
      version: room.version,
      nightPhase: room.nightPhase,
      discussionLifecycle: room.discussionLifecycle,
      discussionEnforcementReady: room.discussionEnforcementReady,
      discussionCycleId: room.discussionCycleId,
      ballotId: room.ballotId,
      discussionDeadlineAt: room.discussionDeadlineAt,
      timerDeadline: deadlineRaw === null ? null : Number(deadlineRaw),
      timers: room.settings?.timers ?? null,
      playerCount: players.length,
      aliveCount: players.filter((p) => p.alive).length,
      pendingNightActions: (room.pendingNightActions || []).map((a) => ({ actorTelegramId: a.actorTelegramId, actionType: a.actionType, targetTelegramId: a.targetTelegramId, round: a.round })),
      silencedPlayerId: room.silencedPlayerId,
      silencedUntilRound: room.silencedUntilRound,
      now: Date.now(),
    });
  }
  console.log(JSON.stringify(rows, null, 2));
  await redis.quit();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ name: err?.name, message: err?.message }));
  process.exitCode = 1;
});
