import { monotonicClock, type Clock } from '../clock.js';
import { validateNumberOption } from '../options.js';

/**
 * Turns a stream of per-frame detections into discrete "appeared" events.
 *
 * - **Confirmation is counted in frames.** A key must be seen in `minSightings` consecutive
 *   observed frames before it is reported. This does not depend on time, so it works with any
 *   timeout and frame rate.
 * - **Presence is measured in time.** Once reported, a key is reported again only after it has
 *   been absent for longer than `timeoutMs`, so missed frames never cause duplicate reports.
 */
export class PresenceTracker {
  readonly #timeoutMs: number;
  readonly #clock: Clock;
  readonly #minSightings: number;
  /** Reported keys and when they were last seen. */
  readonly #present = new Map<string, number>();
  /** For each key seen in the previous frame: how many consecutive frames it has been seen in. */
  #streaks = new Map<string, number>();

  /**
   * @param timeoutMs Absence after which a reported key counts as gone.
   * @param clock Defaults to a monotonic clock, so system time changes cannot skew timeouts.
   * @param minSightings Consecutive frames a key must be seen in before it is reported. Default `1`.
   */
  constructor(timeoutMs: number, clock: Clock = monotonicClock, minSightings = 1) {
    this.#timeoutMs = validateNumberOption('presenceTimeoutMs', timeoutMs);
    this.#minSightings = validateNumberOption('minFrameConfirmations', minSightings);
    this.#clock = clock;
  }

  /** Records the keys seen in one frame and returns those that just appeared. */
  observe(keys: Iterable<string>): string[] {
    const now = this.#clock();
    for (const [key, lastSeenAt] of this.#present) {
      if (now - lastSeenAt > this.#timeoutMs) this.#present.delete(key);
    }

    const streaks = new Map<string, number>();
    const appeared: string[] = [];
    for (const key of new Set(keys)) {
      const streak = (this.#streaks.get(key) ?? 0) + 1;
      streaks.set(key, streak);
      if (this.#present.has(key)) {
        this.#present.set(key, now);
      } else if (streak >= this.#minSightings) {
        this.#present.set(key, now);
        appeared.push(key);
      }
    }
    // Keys missing from this frame lose their streak.
    this.#streaks = streaks;
    return appeared;
  }

  reset(): void {
    this.#present.clear();
    this.#streaks = new Map();
  }
}
