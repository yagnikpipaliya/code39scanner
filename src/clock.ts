/** Milliseconds from an arbitrary, fixed origin. */
export type Clock = () => number;

/**
 * Monotonic clock for measuring durations. Unlike `Date.now()`, it never jumps when the system
 * time changes (NTP sync, manual edits, DST), so elapsed times are always correct.
 */
export const monotonicClock: Clock = () => performance.now();
