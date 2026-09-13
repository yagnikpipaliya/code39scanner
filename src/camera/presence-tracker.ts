import { monotonicClock, type Clock } from '../clock.js';
import { validateNumberOption } from '../options.js';

interface Presence {
  lastSeenAt: number;
  sightings: number;
  reported: boolean;
}

/**
 * Turns a stream of per-frame detections into discrete "appeared" events.
 *
 * A key is reported once it has been seen in `minSightings` frames, each within `timeoutMs` of
 * the previous sighting, and again only after it has been absent for longer than `timeoutMs`.
 * Occasional missed frames therefore neither cause duplicate reports nor reset confirmation.
 */
export class PresenceTracker {
  readonly #timeoutMs: number;
  readonly #clock: Clock;
  readonly #minSightings: number;
  readonly #presences = new Map<string, Presence>();

  /**
   * @param timeoutMs Absence after which a key counts as gone.
   * @param clock Defaults to a monotonic clock, so system time changes cannot skew timeouts.
   * @param minSightings Frames a key must be seen in before it is reported. Default `1`.
   */
  constructor(timeoutMs: number, clock: Clock = monotonicClock, minSightings = 1) {
    this.#timeoutMs = validateNumberOption('presenceTimeoutMs', timeoutMs);
    this.#minSightings = validateNumberOption('minFrameConfirmations', minSightings);
    this.#clock = clock;
  }

  /** Records the keys seen in one frame and returns those that just appeared. */
  observe(keys: Iterable<string>): string[] {
    const now = this.#clock();
    for (const [key, presence] of this.#presences) {
      if (now - presence.lastSeenAt > this.#timeoutMs) this.#presences.delete(key);
    }

    const appeared: string[] = [];
    for (const key of new Set(keys)) {
      const presence = this.#presences.get(key) ?? {
        lastSeenAt: now,
        sightings: 0,
        reported: false,
      };
      presence.lastSeenAt = now;
      presence.sightings++;
      if (!presence.reported && presence.sightings >= this.#minSightings) {
        presence.reported = true;
        appeared.push(key);
      }
      this.#presences.set(key, presence);
    }
    return appeared;
  }

  reset(): void {
    this.#presences.clear();
  }
}
