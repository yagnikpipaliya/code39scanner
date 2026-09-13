import { describe, expect, it } from 'vitest';
import { PresenceTracker } from '../src/camera/presence-tracker.js';
import { InvalidOptionsError } from '../src/errors.js';

function setup(timeoutMs = 1000) {
  let now = 0;
  const tracker = new PresenceTracker(timeoutMs, () => now);
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
});
