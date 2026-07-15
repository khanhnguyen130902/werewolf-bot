/**
 * Clock abstraction so the engine never calls Date.now() directly.
 * This makes time-dependent logic (timers, timeouts, round timestamps)
 * deterministically testable and allows the Telegram layer / scheduler
 * to inject a controllable clock in tests.
 */
export interface ClockPort {
  now(): number; // epoch millis
}

export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }
}
