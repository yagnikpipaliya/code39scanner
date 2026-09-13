import { monotonicClock, type Clock } from '../clock.js';
import { FRAME_CONFIRMATION_WINDOW, validateNumberOption } from '../options.js';

/**
 * Turns a stream of per-frame detections into discrete "appeared" events.
 *
 * - **Confirmation is counted in frames.** A key is reported once it has been seen in
 *   `minSightings` of the last {@link FRAME_CONFIRMATION_WINDOW} observed frames. Misses in
 *   between (motion blur, scanlines that move between frames) do not reset the count, and it does
 *   not depend on time, so it works with any timeout and frame rate.
 * - **Presence is measured in time.** Once reported, a key is reported again only after it has
 *   been absent for longer than `timeoutMs`, so missed frames never cause duplicate reports.
 */
export class PresenceTracker {
  readonly #timeoutMs: number;
  readonly #clock: Clock;
  readonly #minSightings: number;
  /** Reported keys and when they were last seen. */
  readonly #present = new Map<string, number>();
  /** Indices of the recent frames each key was seen in, oldest first. */
  readonly #sightings = new Map<string, number[]>();
  #frame = 0;

  /**
   * @param timeoutMs Absence after which a reported key counts as gone.
   * @param clock Defaults to a monotonic clock, so system time changes cannot skew timeouts.
   * @param minSightings Frames, out of the last {@link FRAME_CONFIRMATION_WINDOW}, a key must be
   *   seen in before it is reported. Default `1`.
   */
  constructor(timeoutMs: number, clock: Clock = monotonicClock, minSightings = 1) {
    this.#timeoutMs = validateNumberOption('presenceTimeoutMs', timeoutMs);
    this.#minSightings = validateNumberOption('minFrameConfirmations', minSightings);
    this.#clock = clock;
  }

  /** Records the keys seen in one frame and returns those that just appeared. */
  observe(keys: Iterable<string>): string[] {
    const now = this.#clock();
    const frame = ++this.#frame;
    this.#forgetStale(now, frame);

    const appeared: string[] = [];
    for (const key of new Set(keys)) {
      const frames = this.#sightings.get(key) ?? [];
      frames.push(frame);
      this.#sightings.set(key, frames);
      if (this.#present.has(key)) {
        this.#present.set(key, now);
      } else if (frames.length >= this.#minSightings) {
        this.#present.set(key, now);
        appeared.push(key);
      }
    }
    return appeared;
  }

  reset(): void {
    this.#present.clear();
    this.#sightings.clear();
    this.#frame = 0;
  }

  /** Drops presences older than the timeout and sightings outside the confirmation window. */
  #forgetStale(now: number, frame: number): void {
    for (const [key, lastSeenAt] of this.#present) {
      if (now - lastSeenAt > this.#timeoutMs) {
        // The key is gone: its earlier sightings must not confirm its next appearance.
        this.#present.delete(key);
        this.#sightings.delete(key);
      }
    }
    const oldestCounted = frame - FRAME_CONFIRMATION_WINDOW + 1;
    for (const [key, frames] of this.#sightings) {
      const recent = frames.filter((seen) => seen >= oldestCounted);
      if (recent.length > 0) this.#sightings.set(key, recent);
      else this.#sightings.delete(key);
    }
  }
}
