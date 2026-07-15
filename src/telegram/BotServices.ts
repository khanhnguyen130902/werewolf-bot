import { Redis } from 'ioredis';
import { RoomService } from '../engine/RoomService';
import { GameService } from '../engine/GameService';
import { NightActionService } from '../engine/NightActionService';
import { DayService } from '../engine/DayService';
import { RoomTimerService } from '../engine/RoomTimerService';
import { GameOrchestrator } from '../engine/GameOrchestrator';
import { EventBus } from '../engine/events/EventBus';
import { SystemClock } from '../engine/ports/ClockPort';
import { SystemRandom } from '../engine/ports/RandomPort';
import { createPhase1RoleRegistry } from '../engine/roles/RoleRegistry';
import { createDefaultDistributionStrategyRegistry } from '../engine/role-distribution/RoleDistributionStrategyRegistry';
import { GameStateMachine } from '../engine/state-machine/GameStateMachine';
import { RedisStorageAdapter } from '../infrastructure/redis/RedisStorageAdapter';
import { BullMqSchedulerPort } from '../infrastructure/scheduler/BullMqSchedulerPort';

/**
 * Composition root for the Telegram bot process: constructs every engine
 * service exactly once, wired to the real Redis/BullMQ adapters, and
 * exposes them as a single container. This is the ONLY place in the entire
 * codebase where engine services are instantiated with concrete
 * (non-test-double) infrastructure -- every other module either receives
 * these instances via constructor injection or imports only interfaces.
 */
export class BotServices {
  public readonly redis: Redis;
  public readonly eventBus: EventBus;
  public readonly roomService: RoomService;
  public readonly gameService: GameService;
  public readonly nightActionService: NightActionService;
  public readonly dayService: DayService;
  public readonly timerService: RoomTimerService;
  public readonly orchestrator: GameOrchestrator;
  public readonly storage: RedisStorageAdapter;
  public readonly scheduler: BullMqSchedulerPort;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.eventBus = new EventBus();

    const clock = new SystemClock();
    const random = new SystemRandom();
    const roleRegistry = createPhase1RoleRegistry();
    const distributionRegistry = createDefaultDistributionStrategyRegistry();
    const stateMachine = new GameStateMachine();

    this.storage = new RedisStorageAdapter(this.redis);
    // BullMQ requires its own connection options (host/port), not a shared
    // ioredis client instance, since it manages connection lifecycle
    // internally for blocking operations. We parse the same redisUrl so
    // both point at the identical Redis instance.
    const url = new URL(redisUrl);
    this.scheduler = new BullMqSchedulerPort({
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    });

    this.roomService = new RoomService(this.storage, clock, this.eventBus);
    this.gameService = new GameService(
      this.storage,
      clock,
      random,
      this.eventBus,
      roleRegistry,
      distributionRegistry,
      stateMachine,
    );
    this.nightActionService = new NightActionService(
      this.storage,
      clock,
      random,
      this.eventBus,
      roleRegistry,
      stateMachine,
    );
    this.dayService = new DayService(this.storage, clock, this.eventBus, stateMachine);
    this.timerService = new RoomTimerService(this.scheduler, this.storage, clock);

    this.orchestrator = new GameOrchestrator(
      this.roomService,
      this.gameService,
      this.nightActionService,
      this.dayService,
      this.timerService,
    );
  }

  async shutdown(): Promise<void> {
    await this.scheduler.shutdown();
    this.redis.disconnect();
  }
}
