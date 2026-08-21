import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { DayService } from '../../src/engine/DayService';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, RoleId, RoomStatus, Team } from '../../src/engine/domain/enums';
import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { ClockPort } from '../../src/engine/ports/ClockPort';

const TOTAL_RUNS = Number(process.env.EDGE_E2E_RUNS ?? '200');

class FakeClock implements ClockPort {
  now(): number {
    return 1000;
  }
}

type Setup = ReturnType<typeof createSetup>;

function createSetup() {
  const storage = new InMemoryStorageAdapter();
  const dayService = new DayService(storage, new FakeClock(), new EventBus(), new GameStateMachine());
  return { storage, dayService };
}

async function createDayRoom(setup: Setup, roomId: string, wolfCount = 1): Promise<void> {
  const room = RoomFactory.create({ id: roomId, hostTelegramId: 'mage', chatId: `chat-${roomId}`, now: 1000 });
  const players: Array<[string, RoleId, Team]> = [
    ['mage', RoleId.SILENT_MAGE, Team.VILLAGE],
    ['villager-1', RoleId.VILLAGER, Team.VILLAGE],
    ['villager-2', RoleId.VILLAGER, Team.VILLAGE],
    ['wolf-1', RoleId.WEREWOLF, Team.WEREWOLF],
  ];
  if (wolfCount > 1) players.push(['wolf-2', RoleId.WEREWOLF, Team.WEREWOLF]);
  for (const [id, role, team] of players) {
    const player = PlayerFactory.create({ telegramId: id, nickname: id, isHost: id === 'mage', joinedAt: 1000 });
    room.players[id] = { ...player, role, team };
  }
  room.status = RoomStatus.LOCKED;
  room.gameState = GameState.DAY;
  room.currentRound = 1;
  room.matchId = `match-${roomId}`;
  await setup.storage.saveRoom(room, -1);
}

async function openActiveDiscussion(setup: Setup, roomId: string, silencedId: string) {
  const opening = await setup.dayService.startDiscussion(roomId);
  const prepared = await setup.storage.getRoom(roomId);
  if (!prepared) throw new Error('room missing');
  prepared.silencedPlayerId = silencedId;
  prepared.silencedUntilRound = prepared.currentRound;
  await setup.storage.saveRoom(prepared, prepared.version);
  return setup.dayService.activateDiscussion(roomId, opening.discussionCycleId!);
}

async function runCase(scenario: string, run: number): Promise<{ scenario: string; run: number; elapsedMs: number; eventCount: number }> {
  const startedAt = performance.now();
  const setup = createSetup();
  const roomId = `edge-${scenario}-${run}`;
  const wolfCount = scenario === 'terminal-speech' || scenario === 'stale-ballot' || scenario === 'callback-after-transition' ? 1 : 2;
  await createDayRoom(setup, roomId, wolfCount);

  if (scenario === 'opening-not-ready') {
    const opening = await setup.dayService.startDiscussion(roomId);
    const room = await setup.storage.getRoom(roomId);
    if (!room) throw new Error('room missing');
    room.silencedPlayerId = 'villager-1';
    room.silencedUntilRound = 1;
    await setup.storage.saveRoom(room, room.version);
    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `opening-${run}`, speakerTelegramId: 'villager-1', chatId: room.chatId, messageKind: 'TEXT',
    });
    expect(opening.discussionEnforcementReady).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('NOT_READY_OR_STALE_PHASE');
    expect((await setup.storage.getRoom(roomId))?.players['villager-1'].alive).toBe(true);
  } else if (scenario === 'stale-cycle') {
    await setup.dayService.startDiscussion(roomId);
    await expect(setup.dayService.activateDiscussion(roomId, `stale-${run}`)).rejects.toThrow();
  } else if (scenario === 'speech-non-silenced') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `non-silenced-${run}`, speakerTelegramId: 'villager-2', chatId: active.chatId, messageKind: 'STICKER',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('NOT_SILENCED');
    expect((await setup.storage.getRoom(roomId))?.players['villager-2'].alive).toBe(true);
  } else if (scenario === 'dead-speaker') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const room = await setup.storage.getRoom(roomId);
    if (!room) throw new Error('room missing');
    room.players['villager-1'].alive = false;
    await setup.storage.saveRoom(room, room.version);
    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `dead-speaker-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'VOICE',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('PLAYER_ALREADY_DEAD');
  } else if (scenario === 'duplicate-speech') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const params = { roomId, speechEventId: `duplicate-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'GIF' as const };
    const first = await setup.dayService.resolveDiscussionSpeechViolation(params);
    expect(first.accepted).toBe(true);
    await expect(setup.dayService.resolveDiscussionSpeechViolation(params)).rejects.toThrow();
    expect((await setup.storage.getRoom(roomId))?.players['villager-1'].alive).toBe(false);
  } else if (scenario === 'concurrent-speech') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const results = await Promise.allSettled([
      setup.dayService.resolveDiscussionSpeechViolation({ roomId, speechEventId: `race-a-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT' }),
      setup.dayService.resolveDiscussionSpeechViolation({ roomId, speechEventId: `race-b-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'VOICE' }),
    ]);
    const accepted = results.filter((entry) => entry.status === 'fulfilled' && entry.value.accepted);
    expect(accepted).toHaveLength(1);
    expect((await setup.storage.getRoom(roomId))?.players['villager-1'].alive).toBe(false);
  } else if (scenario === 'speech-vote-race') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const results = await Promise.allSettled([
      setup.dayService.resolveDiscussionSpeechViolation({ roomId, speechEventId: `speech-vote-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT' }),
      setup.dayService.submitVote({ roomId, actionId: `vote-before-${run}`, voterTelegramId: 'villager-2', targetTelegramId: 'mage' }),
    ]);
    const speechAccepted = results.filter((entry) => entry.status === 'fulfilled' && 'accepted' in entry.value && entry.value.accepted);
    expect(speechAccepted).toHaveLength(1);
    const finalRoom = await setup.storage.getRoom(roomId);
    expect([GameState.VOTING, GameState.GAME_OVER]).toContain(finalRoom?.gameState);
    expect(finalRoom?.players['villager-1'].alive).toBe(false);
  } else if (scenario === 'stale-ballot') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const speech = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `ballot-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
    });
    expect([GameState.VOTING, GameState.GAME_OVER]).toContain(speech.room.gameState);
    await expect(setup.dayService.submitVote({
      roomId, actionId: `old-ballot-${run}`, ballotId: 'old-ballot', voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    })).rejects.toThrow();
    const accepted = await setup.dayService.submitVote({
      roomId, actionId: `current-ballot-${run}`, ballotId: speech.room.ballotId, voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    });
    expect(accepted.players['villager-2'].hasVotedThisRound).toBe(true);
  } else if (scenario === 'terminal-speech') {
    const active = await openActiveDiscussion(setup, roomId, 'wolf-1');
    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `terminal-${run}`, speakerTelegramId: 'wolf-1', chatId: active.chatId, messageKind: 'VOICE',
    });
    expect(result.accepted).toBe(true);
    expect(result.room.gameState).toBe(GameState.GAME_OVER);
    expect(result.winner).toBe('VILLAGE');
    await expect(setup.dayService.submitVote({
      roomId, actionId: `vote-after-game-over-${run}`, ballotId: result.room.ballotId, voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    })).rejects.toThrow();
  } else if (scenario === 'callback-after-transition') {
    const active = await openActiveDiscussion(setup, roomId, 'villager-1');
    const speech = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId, speechEventId: `transition-${run}`, speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
    });
    const accepted = await setup.dayService.submitVote({
      roomId, actionId: `vote-after-transition-${run}`, ballotId: speech.room.ballotId, voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    });
    expect(accepted.gameState).toBe(GameState.VOTING);
    expect(accepted.players['villager-2'].hasVotedThisRound).toBe(true);
  } else {
    throw new Error(`Unknown scenario ${scenario}`);
  }

  const current = await setup.storage.getRoom(roomId);
  const events = await setup.storage.getEvents(current?.matchId ?? `match-${roomId}`);
  expect(events.length).toBeGreaterThan(0);
  return { scenario, run, elapsedMs: performance.now() - startedAt, eventCount: events.length };
}

describe('Silent Mage unhappy and edge-case E2E regression', () => {
  it('passes 200 adversarial case-runs across all speech/gate/vote race scenarios', async () => {
    const scenarios = [
      'opening-not-ready',
      'stale-cycle',
      'speech-non-silenced',
      'dead-speaker',
      'duplicate-speech',
      'concurrent-speech',
      'speech-vote-race',
      'stale-ballot',
      'terminal-speech',
      'callback-after-transition',
    ];
    const results: Array<{ scenario: string; run: number; elapsedMs: number; eventCount: number }> = [];
    for (let run = 1; run <= TOTAL_RUNS; run += 1) {
      results.push(await runCase(scenarios[(run - 1) % scenarios.length], run));
    }
    const metrics = {
      requestedRuns: TOTAL_RUNS,
      passedRuns: results.length,
      scenarioCounts: Object.fromEntries(scenarios.map((scenario) => [scenario, results.filter((result) => result.scenario === scenario).length])),
      totalEvents: results.reduce((sum, result) => sum + result.eventCount, 0),
      averageElapsedMs: results.reduce((sum, result) => sum + result.elapsedMs, 0) / results.length,
      maxElapsedMs: Math.max(...results.map((result) => result.elapsedMs)),
      results,
    };
    writeFileSync('silent-mage-unhappy-edge-e2e-200-results.json', JSON.stringify(metrics, null, 2));
    expect(metrics.passedRuns).toBe(TOTAL_RUNS);
    expect(metrics.scenarioCounts['opening-not-ready']).toBeGreaterThan(0);
    expect(metrics.scenarioCounts['speech-vote-race']).toBeGreaterThan(0);
    expect(metrics.scenarioCounts['stale-ballot']).toBeGreaterThan(0);
    expect(metrics.scenarioCounts['terminal-speech']).toBeGreaterThan(0);
    expect(metrics.totalEvents).toBeGreaterThan(0);
  }, 240000);
});

export {};
