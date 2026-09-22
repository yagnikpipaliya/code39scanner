// Code 39 symbology, scanline binarizing and width decoding: everything that turns pixels into
// text. Opening a camera and feeding frames in is the caller's job.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';
// 9-bit wide/narrow masks in ALPHABET order; the first of the 9 elements is the top bit.
const MASKS = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, 0x109, 0x049, 0x148,
  0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c, 0x103, 0x043, 0x142, 0x013, 0x112, 0x052,
  0x007, 0x106, 0x046, 0x016, 0x181, 0x0c1, 0x1c0, 0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4,
  0x0a8, 0x0a2, 0x08a, 0x02a, 0x094,
];
const CHARS = new Map(MASKS.map((mask, index) => [mask, ALPHABET[index]]));

const MIN_CONTRAST = 24; // luminance range a scanline needs before it is worth thresholding
const QUIET_ZONE = 5; // blank margin required at both ends of a symbol, in narrow-bar widths
const MAX_GAP = 6; // widest gap between two characters, in narrow-bar widths

// One scanline of luminance (0-255) to run lengths, alternating light/dark and starting and
// ending light. The threshold is the midpoint of the line, and edges are interpolated between
// samples so narrow bars stay accurate at low resolution. Null if the line has no contrast.
export function toRuns(samples) {
  let low = 255;
  let high = 0;
  for (const value of samples) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (high - low < MIN_CONTRAST) return null;
  const middle = (low + high) / 2;
  let dark = samples[0] < middle;
  let edge = 0;
  const runs = dark ? [0] : [];
  for (let x = 1; x < samples.length; x++) {
    if ((samples[x] < middle) === dark) continue;
    const before = samples[x - 1] - middle;
    const at = x - 0.5 + before / (before - (samples[x] - middle));
    runs.push(at - edge);
    edge = at;
    dark = !dark;
  }
  runs.push(samples.length - edge);
  return runs.length % 2 === 0 ? [...runs, 0] : runs;
}

// The 9 runs at `offset` as one Code 39 character — exactly the three widest are wide, and they
// must stay clearly apart from the six narrow ones — or null. { char, width, narrow }.
function character(runs, offset) {
  const widths = runs.slice(offset, offset + 9);
  if (widths.length < 9 || widths.some((width) => !(width > 0))) return null;
  const sorted = [...widths].sort((a, b) => b - a);
  if (sorted[2] < sorted[3] * 1.2 || sorted[0] > sorted[2] * 2 || sorted[3] > sorted[8] * 3) {
    return null;
  }
  const wide = sorted[0] + sorted[1] + sorted[2];
  const narrow = sorted.slice(3).reduce((sum, width) => sum + width, 0) / 6;
  const ratio = wide / 3 / narrow;
  if (ratio < 1.6 || ratio > 4.5) return null;
  const mask = widths.reduce((bits, width, i) => bits | ((width >= sorted[2]) << (8 - i)), 0);
  const char = CHARS.get(mask);
  return char === undefined ? null : { char, width: wide + narrow * 6, narrow };
}

// Every distinct symbol on one scanline of runs, read left to right and then reversed, which
// also reads an upside-down label. Returns { text, moduleWidth } per symbol, the module size
// being what that line measured for a narrow bar.
export function decodeRuns(runs) {
  const found = new Map();
  for (const line of [runs, [...runs].reverse()]) {
    for (let start = 1; start + 9 < line.length; start += 2) {
      const first = character(line, start);
      if (first?.char !== '*' || line[start - 1] < QUIET_ZONE * first.narrow) continue;
      let text = '';
      let previous = first;
      let narrows = first.narrow;
      let count = 1;
      // `gap` indexes the light run between the character just read and the next one.
      for (let gap = start + 9; gap + 9 < line.length; gap += 10) {
        const next = line[gap] > MAX_GAP * previous.narrow ? null : character(line, gap + 1);
        if (!next || Math.abs(next.width - previous.width) > previous.width * 0.25) break;
        narrows += next.narrow;
        count++;
        if (next.char !== '*') {
          text += next.char;
          previous = next;
          continue;
        }
        if (text && (line[gap + 10] ?? 0) >= QUIET_ZONE * next.narrow) {
          found.set(text, { text, moduleWidth: narrows / count });
          start = gap + 9;
        }
        break;
      }
    }
  }
  return [...found.values()];
}
