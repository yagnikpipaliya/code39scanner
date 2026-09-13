/**
 * Turns a stream of per-frame detections into discrete "appeared" events.
 *
 * A key is reported when it is first seen, and again only after it has been absent for longer
 * than `timeoutMs`. Occasional missed frames therefore do not cause duplicate reports.
 */
export class PresenceTracker {
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #lastSeen = new Map<string, number>();

  constructor(timeoutMs: number, now: () => number = () => Date.now()) {
    this.#timeoutMs = timeoutMs;
    this.#now = now;
  }

  /** Records the keys seen in one frame and returns those that just appeared. */
  observe(keys: Iterable<string>): string[] {
    const now = this.#now();
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
