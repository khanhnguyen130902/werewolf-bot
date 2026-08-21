import { DayService } from '../../src/engine/DayService';
import { EventBus } from '../../src/engine/events/EventBus';
import { GameStateMachine } from '../../src/engine/state-machine/GameStateMachine';
import { GameState, RoleId, RoomStatus, Team } from '../../src/engine/domain/enums';
import { RoomFactory } from '../../src/engine/domain/Room';
import { PlayerFactory } from '../../src/engine/domain/Player';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { ClockPort } from '../../src/engine/ports/ClockPort';

type Setup = ReturnType<typeof createSetup>;

class FakeClock implements ClockPort {
  now(): number { return 1000; }
}

function createSetup() {
  const storage = new InMemoryStorageAdapter();
  const dayService = new DayService(storage, new FakeClock(), new EventBus(), new GameStateMachine());
  return { storage, dayService };
}

async function createDayRoom(setup: Setup, wolfCount = 1): Promise<void> {
  const room = RoomFactory.create({ id: 'silent-room', hostTelegramId: 'mage', chatId: 'chat-1', now: 1000 });
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
  room.matchId = 'silent-match';
  await setup.storage.saveRoom(room, -1);
}

async function openActiveDiscussion(setup: Setup, silencedId: string) {
  const opening = await setup.dayService.startDiscussion('silent-room');
  const prepared = await setup.storage.getRoom('silent-room');
  if (!prepared) throw new Error('room missing');
  prepared.silencedPlayerId = silencedId;
  prepared.silencedUntilRound = prepared.currentRound;
  await setup.storage.saveRoom(prepared, prepared.version);
  return setup.dayService.activateDiscussion('silent-room', opening.discussionCycleId!);
}

describe('Silent Mage discussion contract', () => {
  it('keeps enforcement disabled during opening and activates it only after announcement phase', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const opening = await setup.dayService.startDiscussion('silent-room');
    expect(opening.discussionLifecycle).toBe('OPENING');
    expect(opening.discussionEnforcementReady).toBe(false);

    const active = await setup.dayService.activateDiscussion('silent-room', opening.discussionCycleId!);
    expect(active.discussionLifecycle).toBe('ACTIVE');
    expect(active.discussionEnforcementReady).toBe(true);
  });

  it('persists active gate across a storage reload and rejects stale cycle activation', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const opening = await setup.dayService.startDiscussion('silent-room');
    const reloadedOpening = await setup.storage.getRoom('silent-room');
    expect(reloadedOpening?.discussionCycleId).toBe(opening.discussionCycleId);
    expect(reloadedOpening?.discussionEnforcementReady).toBe(false);

    const active = await setup.dayService.activateDiscussion('silent-room', opening.discussionCycleId!);
    const reloadedActive = await setup.storage.getRoom('silent-room');
    expect(reloadedActive?.discussionLifecycle).toBe('ACTIVE');
    expect(reloadedActive?.discussionEnforcementReady).toBe(true);
    expect(reloadedActive?.discussionCycleId).toBe(active.discussionCycleId);

    await expect(setup.dayService.activateDiscussion('silent-room', 'stale-cycle')).rejects.toThrow();
  });

  it('resolves non-terminal speech death through CHECK_WIN into VOTING', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');

    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room',
      speechEventId: 'speech-1',
      speakerTelegramId: 'villager-1',
      chatId: active.chatId,
      messageKind: 'TEXT',
    });

    expect(result.accepted).toBe(true);
    expect(result.room.gameState).toBe(GameState.VOTING);
    expect(result.room.players['villager-1'].alive).toBe(false);
    expect(result.room.players['villager-1'].deathCause).toBe('SPOKEN_WHILE_SILENCED');
    expect(result.winner).toBe('NONE');
    expect(result.room.currentRound).toBe(1);
  });

  it('resolves terminal speech death through CHECK_WIN into GAME_OVER', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'wolf-1');

    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room',
      speechEventId: 'speech-terminal',
      speakerTelegramId: 'wolf-1',
      chatId: active.chatId,
      messageKind: 'VOICE',
    });

    expect(result.accepted).toBe(true);
    expect(result.room.gameState).toBe(GameState.GAME_OVER);
    expect(result.winner).toBe('VILLAGE');
    expect(result.deaths).toHaveLength(1);
  });

  it('stamps committed speech events with the saved room version', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const result = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room', speechEventId: 'speech-commit-version', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
    });
    const events = await setup.storage.getEvents('silent-match');
    const committed = events.filter((event) => event.commitVersion === result.room.version);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.some((event) => event.type === 'SPEECH_VIOLATION')).toBe(true);
  });

  it('accepts the same speech event only once', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const params = {
      roomId: 'silent-room', speechEventId: 'speech-idempotent', speakerTelegramId: 'villager-1',
      chatId: active.chatId, messageKind: 'TEXT' as const,
    };
    const first = await setup.dayService.resolveDiscussionSpeechViolation(params);
    expect(first.accepted).toBe(true);
    await expect(setup.dayService.resolveDiscussionSpeechViolation(params)).rejects.toThrow();
  });

  it('commits at most one death when two speech events race', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const results = await Promise.allSettled([
      setup.dayService.resolveDiscussionSpeechViolation({
        roomId: 'silent-room', speechEventId: 'speech-race-a', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
      }),
      setup.dayService.resolveDiscussionSpeechViolation({
        roomId: 'silent-room', speechEventId: 'speech-race-b', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'VOICE',
      }),
    ]);
    const accepted = results.filter((entry) => entry.status === 'fulfilled' && entry.value.accepted);
    expect(accepted).toHaveLength(1);
    const finalRoom = await setup.storage.getRoom('silent-room');
    expect(finalRoom?.players['villager-1'].alive).toBe(false);
  });

  it('handles concurrent speech violation and vote callback without duplicate speech death', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const results = await Promise.allSettled([
      setup.dayService.resolveDiscussionSpeechViolation({
        roomId: 'silent-room', speechEventId: 'speech-vote-race', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
      }),
      setup.dayService.submitVote({
        roomId: 'silent-room', actionId: 'vote-race', voterTelegramId: 'villager-2', targetTelegramId: 'mage',
      }),
    ]);
    const speechResults = results.filter((entry) => entry.status === 'fulfilled' && 'accepted' in entry.value && entry.value.accepted);
    expect(speechResults).toHaveLength(1);
    const finalRoom = await setup.storage.getRoom('silent-room');
    expect(finalRoom?.gameState).toBe(GameState.VOTING);
    expect(finalRoom?.players['villager-1'].alive).toBe(false);
  });

  it('persists a ballotId when discussion transitions into VOTING and rejects stale ballot callbacks', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const speech = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room', speechEventId: 'speech-ballot-token', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
    });
    expect(speech.room.gameState).toBe(GameState.VOTING);
    expect(speech.room.ballotId).toBeTruthy();
    await expect(setup.dayService.submitVote({
      roomId: 'silent-room', actionId: 'stale-ballot', ballotId: 'old-ballot', voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    })).rejects.toThrow();
    const accepted = await setup.dayService.submitVote({
      roomId: 'silent-room', actionId: 'current-ballot', ballotId: speech.room.ballotId!, voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    });
    expect(accepted.players['villager-2'].hasVotedThisRound).toBe(true);
  });

  it('accepts a callback that arrives after the speech transition only when its target is still alive', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const active = await openActiveDiscussion(setup, 'villager-1');
    const speech = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room', speechEventId: 'speech-before-vote', speakerTelegramId: 'villager-1', chatId: active.chatId, messageKind: 'TEXT',
    });
    expect(speech.room.gameState).toBe(GameState.VOTING);
    const vote = await setup.dayService.submitVote({
      roomId: 'silent-room', actionId: 'current-vote-after-transition', ballotId: speech.room.ballotId,
      voterTelegramId: 'villager-2', targetTelegramId: 'mage',
    });
    expect(vote.gameState).toBe(GameState.VOTING);
    expect(vote.players['villager-2'].hasVotedThisRound).toBe(true);
  });

  it('does not enforce speech before activation or after the cycle is closed', async () => {
    const setup = createSetup();
    await createDayRoom(setup);
    const opening = await setup.dayService.startDiscussion('silent-room');
    const prepared = await setup.storage.getRoom('silent-room');
    if (!prepared) throw new Error('room missing');
    prepared.silencedPlayerId = 'villager-1';
    prepared.silencedUntilRound = 1;
    await setup.storage.saveRoom(prepared, prepared.version);

    const beforeActivation = await setup.dayService.resolveDiscussionSpeechViolation({
      roomId: 'silent-room', speechEventId: 'speech-opening', speakerTelegramId: 'villager-1',
      chatId: 'chat-1', messageKind: 'TEXT',
    });
    expect(beforeActivation.accepted).toBe(false);
    expect(beforeActivation.reason).toBe('NOT_READY_OR_STALE_PHASE');

    await setup.dayService.activateDiscussion('silent-room', opening.discussionCycleId!);
    const closed = await setup.dayService.startVoting('silent-room');
    expect(closed.discussionLifecycle).toBe('CLOSED');
    expect(closed.discussionEnforcementReady).toBe(false);
  });
});
