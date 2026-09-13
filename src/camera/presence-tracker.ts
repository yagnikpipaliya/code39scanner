import { monotonicClock, type Clock } from '../clock.js';
import { validateNumberOption } from '../options.js';

/**
 * Turns a stream of per-frame detections into discrete "appeared" events.
 *
 * A key is reported when it is first seen, and again only after it has been absent for longer
 * than `timeoutMs`. Occasional missed frames therefore do not cause duplicate reports.
 */
export class PresenceTracker {
  readonly #timeoutMs: number;
  readonly #clock: Clock;
  readonly #lastSeen = new Map<string, number>();

  /** @param clock Defaults to a monotonic clock, so system time changes cannot skew timeouts. */
  constructor(timeoutMs: number, clock: Clock = monotonicClock) {
    this.#timeoutMs = validateNumberOption('presenceTimeoutMs', timeoutMs);
    this.#clock = clock;
  }

  /** Records the keys seen in one frame and returns those that just appeared. */
  observe(keys: Iterable<string>): string[] {
    const now = this.#clock();
    for (const [key, seenAt] of this.#lastSeen) {
      if (now - seenAt > this.#timeoutMs) this.#lastSeen.delete(key);
    }
    const appeared: string[] = [];
    for (const key of keys) {
      if (!this.#lastSeen.has(key)) appeared.push(key);
      this.#lastSeen.set(key, now);
    }
    return appeared;
  }

  reset(): void {
    this.#lastSeen.clear();
  }
}
