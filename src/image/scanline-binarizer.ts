/**
 * Converts one line of luminance samples into bar/space run-lengths with sub-pixel edges.
 *
 * - A small smoothing kernel suppresses sensor noise.
 * - The threshold is local (midpoint of the sliding min/max), so uneven lighting and shadows
 *   across the barcode do not break it.
 * - Regions without local contrast (quiet zones, margins) are classified as light.
 * - Edges are placed where the signal crosses the threshold, linearly interpolated between
 *   samples, which keeps narrow elements accurate at low resolution.
 */

/** Minimum luminance range for a line to be considered at all. */
const MIN_LINE_CONTRAST = 24;
/** Local contrast (as a fraction of the line's contrast) required to place a threshold. */
const MIN_LOCAL_CONTRAST_FRACTION = 0.25;
/** Percentiles used to estimate the line's dark and light levels robustly. */
const DARK_PERCENTILE = 0.02;
const LIGHT_PERCENTILE = 0.98;
/** Sliding window radius as a fraction of the line length (window must span a wide bar). */
const WINDOW_RADIUS_FRACTION = 1 / 16;
const MIN_WINDOW_RADIUS = 8;

/** [1 2 1] / 4 smoothing with clamped borders. */
function smooth(samples: ArrayLike<number>): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const left = samples[Math.max(0, x - 1)]!;
    const right = samples[Math.min(n - 1, x + 1)]!;
    out[x] = (left + 2 * samples[x]! + right) / 4;
  }
  return out;
}

/** Luminance values at the given percentiles, via a 256-bin histogram. */
function percentiles(values: Float32Array, low: number, high: number): [number, number] {
  const histogram = new Uint32Array(256);
  for (const v of values) histogram[Math.min(255, Math.max(0, Math.round(v)))]!++;
  const find = (fraction: number): number => {
    const target = fraction * values.length;
    let cumulative = 0;
    for (let level = 0; level < 256; level++) {
      cumulative += histogram[level]!;
      if (cumulative > target) return level;
    }
    return 255;
  };
  return [find(low), find(high)];
}

/** Sliding-window extreme in O(n) using a monotonic deque. */
function slidingExtreme(
  values: Float32Array,
  radius: number,
  keeps: (candidate: number, incoming: number) => boolean,
): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let x = 0; x < n; x++) {
    for (const last = Math.min(n - 1, x + radius); next <= last; next++) {
      while (tail > head && !keeps(values[deque[tail - 1]!]!, values[next]!)) tail--;
      deque[tail++] = next;
    }
    while (deque[head]! < x - radius) head++;
    out[x] = values[deque[head]!]!;
  }
  return out;
}

/**
 * Returns run-lengths alternating light/dark, starting and ending with a light run
 * (possibly 0 wide), or `null` if the line has no usable contrast.
 */
export function binarizeLine(samples: ArrayLike<number>): number[] | null {
  const n = samples.length;
  if (n < 3) return null;

  const signal = smooth(samples);
  const [dark, light] = percentiles(signal, DARK_PERCENTILE, LIGHT_PERCENTILE);
  if (light - dark < MIN_LINE_CONTRAST) return null;

  const radius = Math.max(MIN_WINDOW_RADIUS, Math.round(n * WINDOW_RADIUS_FRACTION));
  const localMin = slidingExtreme(signal, radius, (kept, incoming) => kept < incoming);
  const localMax = slidingExtreme(signal, radius, (kept, incoming) => kept > incoming);
  const minLocalContrast = (light - dark) * MIN_LOCAL_CONTRAST_FRACTION;

  // Signed distance from the threshold: >= 0 is light, < 0 is dark.
  const distance = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const min = localMin[x]!;
    const max = localMax[x]!;
    distance[x] = max - min >= minLocalContrast ? signal[x]! - (min + max) / 2 : 1;
  }

  // Positions are in pixel-edge coordinates: the line spans [0, n] and sample `x` sits at the
  // center of pixel `x`, i.e. at `x + 0.5`.
  const runs: number[] = [];
  if (distance[0]! < 0) runs.push(0);
  let lastEdge = 0;
  for (let x = 0; x < n - 1; x++) {
    const a = distance[x]!;
    const b = distance[x + 1]!;
    if (a >= 0 !== b >= 0) {
      const edge = x + 0.5 + a / (a - b);
      runs.push(edge - lastEdge);
      lastEdge = edge;
    }
  }
  runs.push(n - lastEdge);
  if (runs.length % 2 === 0) runs.push(0);
  return runs;
}
