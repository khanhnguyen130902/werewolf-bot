import { RoomService } from '../../src/engine/RoomService';
import { InMemoryStorageAdapter } from '../../src/infrastructure/redis/InMemoryStorageAdapter';
import { EventBus } from '../../src/engine/events/EventBus';
import { ClockPort } from '../../src/engine/ports/ClockPort';
import { DmNotReachableError, RoomNotFoundError } from '../../src/engine/errors/DomainError';

class FixedClock implements ClockPort {
  now(): number { return 1000; }
}

describe('RoomService.joinRoom error precedence', () => {
  it('returns RoomNotFoundError before DM reachability when no room exists', async () => {
    const storage = new InMemoryStorageAdapter(false);
    const service = new RoomService(storage, new FixedClock(), new EventBus());
    await expect(service.joinRoom({ roomId: 'missing', telegramId: 'user', nickname: 'User' }))
      .rejects.toBeInstanceOf(RoomNotFoundError);
  });

  it('returns DmNotReachableError only after the room exists', async () => {
    const storage = new InMemoryStorageAdapter(false);
    storage.markDmReachable('host');
    const service = new RoomService(storage, new FixedClock(), new EventBus());
    await service.createRoom({ roomId: 'room', hostTelegramId: 'host', hostNickname: 'Host', chatId: 'chat' });
    await expect(service.joinRoom({ roomId: 'room', telegramId: 'user', nickname: 'User' }))
      .rejects.toBeInstanceOf(DmNotReachableError);
  });
});
