import { DomainEvent } from './DomainEvent';

export type EventListener = (event: DomainEvent) => void | Promise<void>;

/**
 * Minimal pub/sub used to decouple the Game Engine from any presentation
 * layer (Telegram, future Discord/Web, etc). The engine only ever calls
 * `publish`; it never imports Telegraf or knows a listener exists.
 *
 * Kept intentionally dependency-free (no external event-emitter lib) so the
 * engine package has zero coupling to Node-specific APIs beyond what TS/JS
 * gives natively — this matters for the "reusable on other platforms"
 * requirement (SRS instruction #7), e.g. if the engine ever runs in a
 * browser or a different JS runtime.
 */
export class EventBus {
  private listeners: EventListener[] = [];

  subscribe(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
