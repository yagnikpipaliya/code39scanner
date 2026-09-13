import { describe, expect, it } from 'vitest';
import { PresenceTracker } from '../src/camera/presence-tracker.js';
import { InvalidOptionsError } from '../src/errors.js';
import { FRAME_CONFIRMATION_WINDOW } from '../src/options.js';

function setup(timeoutMs = 1000, minSightings = 1) {
  let now = 0;
  const tracker = new PresenceTracker(timeoutMs, () => now, minSightings);
  return { tracker, advance: (ms: number) => (now += ms) };
}

describe('PresenceTracker', () => {
  it('reports a key once while it stays in view', () => {
    const { tracker, advance } = setup();
    expect(tracker.observe(['A'])).toEqual(['A']);
    for (let i = 0; i < 20; i++) {
      advance(100);
      expect(tracker.observe(['A'])).toEqual([]);
    }
  });

  it('tolerates gaps up to the timeout (missed frames)', () => {
    const { tracker, advance } = setup();
    tracker.observe(['A']);
    advance(1000);
    expect(tracker.observe(['A'])).toEqual([]);
  });

  it('reports again after the key was absent longer than the timeout', () => {
    const { tracker, advance } = setup();
    tracker.observe(['A']);
    advance(500);
    tracker.observe([]);
    advance(501);
    expect(tracker.observe(['A'])).toEqual(['A']);
  });

  it('tracks keys independently and de-duplicates within a frame', () => {
    const { tracker, advance } = setup();
    expect(tracker.observe(['A', 'B', 'A'])).toEqual(['A', 'B']);
    advance(600);
    tracker.observe(['B']);
    advance(600);
    expect(tracker.observe(['A', 'B'])).toEqual(['A']);
  });

  it('forgets everything on reset', () => {
    const { tracker } = setup();
    tracker.observe(['A']);
    tracker.reset();
    expect(tracker.observe(['A'])).toEqual(['A']);
  });

  it('uses a monotonic clock by default', () => {
    expect(new PresenceTracker(1000).observe(['A'])).toEqual(['A']);
  });

  it.each([Number.NaN, -1, Infinity])('rejects an invalid timeout (%s)', (timeoutMs) => {
    expect(() => new PresenceTracker(timeoutMs)).toThrow(InvalidOptionsError);
  });

  it.each([0, 1.5, FRAME_CONFIRMATION_WINDOW + 1])(
    'rejects an invalid sighting count (%s)',
    (minSightings) => {
      expect(() => new PresenceTracker(1000, () => 0, minSightings)).toThrow(InvalidOptionsError);
    },
  );
});

describe('PresenceTracker with minSightings', () => {
  it('reports a key once it has been seen in enough frames', () => {
    const { tracker } = setup(1000, 3);
    expect(tracker.observe(['A'])).toEqual([]);
    expect(tracker.observe(['A'])).toEqual([]);
    expect(tracker.observe(['A'])).toEqual(['A']);
    expect(tracker.observe(['A'])).toEqual([]);
  });

  it('does not reset the count on missed frames within the window', () => {
    // Moving scanlines cross a small barcode only in some frames.
    const { tracker } = setup(1000, 2);
    expect(tracker.observe(['A'])).toEqual([]);
    for (let i = 0; i < FRAME_CONFIRMATION_WINDOW - 2; i++) expect(tracker.observe([])).toEqual([]);
    expect(tracker.observe(['A'])).toEqual(['A']);
  });

  it('forgets sightings older than the window', () => {
    const { tracker } = setup(1000, 2);
    tracker.observe(['A']);
    for (let i = 0; i < FRAME_CONFIRMATION_WINDOW - 1; i++) tracker.observe([]);
    expect(tracker.observe(['A'])).toEqual([]);
    expect(tracker.observe(['A'])).toEqual(['A']);
  });

  it('keeps confirming with any timeout, even 0', () => {
    // Timeout 0 treats every frame gap as the key leaving, so each report needs a fresh
    // confirmation, but detection never stops.
    const { tracker, advance } = setup(0, 2);
    const reports: string[][] = [];
    for (let i = 0; i < 6; i++) {
      reports.push(tracker.observe(['A']));
      advance(100);
    }
    expect(reports).toEqual([[], ['A'], [], ['A'], [], ['A']]);
  });

  it('requires a fresh confirmation when a reported key comes back', () => {
    const { tracker, advance } = setup(300, 3);
    const frame = (keys: string[]) => {
      const appeared = tracker.observe(keys);
      advance(100);
      return appeared;
    };
    for (let i = 0; i < 8; i++) frame(['A']); // reported on the 3rd frame
    for (let i = 0; i < 4; i++) frame([]); // absent for longer than the timeout
    expect(frame(['A'])).toEqual([]);
    expect(frame(['A'])).toEqual([]);
    expect(frame(['A'])).toEqual(['A']);
  });

  it('keeps a reported key present across missed frames', () => {
    const { tracker, advance } = setup(1000, 2);
    tracker.observe(['A']);
    advance(100);
    expect(tracker.observe(['A'])).toEqual(['A']);
    advance(100);
    tracker.observe([]);
    advance(100);
    expect(tracker.observe(['A'])).toEqual([]);
  });

  it('counts a key once per frame', () => {
    const { tracker } = setup(1000, 2);
    expect(tracker.observe(['A', 'A'])).toEqual([]);
  });

  it('starts counting afresh after reset', () => {
    const { tracker } = setup(1000, 2);
    tracker.observe(['A']);
    tracker.reset();
    expect(tracker.observe(['A'])).toEqual([]);
  });
});
