/**
 * TEST-ONLY Code 39 encoder and synthetic image renderer. Used as an independent oracle for the
 * decoder; the library itself ships no encoder.
 */
import {
  CHAR_TO_PATTERN,
  ELEMENTS_PER_CHARACTER,
  isWideElement,
  START_STOP_CHARACTER,
} from '../../src/core/symbology.js';
import type { RgbaImage } from '../../src/types.js';

export interface EncodeOptions {
  /** Narrow element width (any unit, e.g. pixels). Default 1. */
  narrow?: number;
  /** Wide:narrow ratio. Default 2.5. */
  ratio?: number;
  /** Inter-character gap in narrow widths. Default 1. */
  gap?: number;
  /** Quiet zone on each side in narrow widths. Default 10. */
  quietZone?: number;
  /** Omit the automatic `*` start/stop characters. */
  raw?: boolean;
}

/** Encodes `text` into runs (light, dark, light, …, light) — the decoder's input format. */
export function encodeRuns(text: string, options: EncodeOptions = {}): number[] {
  const { narrow = 1, ratio = 2.5, gap = 1, quietZone = 10, raw = false } = options;
  const symbol = raw ? text : `${START_STOP_CHARACTER}${text}${START_STOP_CHARACTER}`;
  const runs: number[] = [quietZone * narrow];
  [...symbol].forEach((char, index) => {
    const mask = CHAR_TO_PATTERN.get(char);
    if (mask === undefined) throw new Error(`Cannot encode "${char}" in Code 39`);
    if (index > 0) runs.push(gap * narrow);
    for (let e = 0; e < ELEMENTS_PER_CHARACTER; e++) {
      runs.push(isWideElement(mask, e) ? narrow * ratio : narrow);
    }
  });
  runs.push(quietZone * narrow);
  return runs;
}

/** Full ASCII encoding table written independently of the decoder. */
export function toFullAscii(text: string): string {
  const letter = (offset: number) => String.fromCharCode(65 + offset);
  return [...text]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 0) return '%U';
      if (c <= 26) return `$${letter(c - 1)}`;
      if (c <= 31) return `%${letter(c - 27)}`;
      if (c === 32 || c === 45 || c === 46) return ch;
      if (c <= 47) return `/${letter(c - 33)}`;
      if (c <= 57) return ch;
      if (c === 58) return '/Z';
      if (c <= 63) return `%${letter(c - 59 + 5)}`;
      if (c === 64) return '%V';
      if (c <= 90) return ch;
      if (c <= 95) return `%${letter(c - 91 + 10)}`;
      if (c === 96) return '%W';
      if (c <= 122) return `+${letter(c - 97)}`;
      if (c <= 127) return `%${letter(c - 123 + 15)}`;
      throw new Error(`Not ASCII: ${c}`);
    })
    .join('');
}

/** Deterministic PRNG (mulberry32) so noisy tests are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderOptions extends EncodeOptions {
  /** Image height in pixels. Default 60. */
  height?: number;
  /** Vertical fraction of the image covered by bars. Default 0.6. */
  barHeight?: number;
  /** Extra light margin (px) left and right of the quiet zones. Default 0. */
  margin?: number;
  light?: number;
  dark?: number;
  /** Uniform noise amplitude in luminance levels. Default 0. */
  noise?: number;
  /** Box blur radius in pixels. Default 0. */
  blur?: number;
  /** Linear illumination gradient: luminance multiplier from left (1) to right (1 - gradient). */
  gradient?: number;
  seed?: number;
}

/** Renders `text` as an anti-aliased RGBA barcode image. */
export function renderBarcode(text: string, options: RenderOptions = {}): RgbaImage {
  const {
    height = 60,
    barHeight = 0.6,
    margin = 0,
    light = 230,
    dark = 25,
    noise = 0,
    blur = 0,
    gradient = 0,
    seed = 1,
  } = options;
  const runs = encodeRuns(text, options);
  const total = runs.reduce((sum, w) => sum + w, 0);
  const width = Math.ceil(total + 2 * margin);

  // Dark coverage per pixel column (exact area coverage → anti-aliasing).
  let profile: Float32Array = new Float32Array(width);
  let x = margin;
  runs.forEach((w, i) => {
    if (i % 2 === 1) addCoverage(profile, x, x + w);
    x += w;
  });
  for (let r = 0; r < blur; r++) profile = boxBlur(profile);

  const random = seededRandom(seed);
  const top = Math.round((height * (1 - barHeight)) / 2);
  const bottom = height - top;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const coverage = py >= top && py < bottom ? profile[px]! : 0;
      const illumination = 1 - (gradient * px) / width;
      const value = (light - coverage * (light - dark)) * illumination + (random() * 2 - 1) * noise;
      const p = (py * width + px) * 4;
      data[p] = data[p + 1] = data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

function addCoverage(profile: Float32Array, from: number, to: number): void {
  for (let px = Math.floor(from); px < Math.ceil(to) && px < profile.length; px++) {
    profile[px]! += Math.min(px + 1, to) - Math.max(px, from);
  }
}

function boxBlur(profile: Float32Array): Float32Array {
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const l = profile[Math.max(0, i - 1)]!;
    const r = profile[Math.min(profile.length - 1, i + 1)]!;
    out[i] = (l + profile[i]! + r) / 3;
  }
  return out;
}

export function rotate180(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const pixels = width * height;
  for (let i = 0; i < pixels; i++) out.set(data.subarray(i * 4, i * 4 + 4), (pixels - 1 - i) * 4);
  return { width, height, data: out };
}

/** Rotates 90° clockwise (bars become horizontal). */
export function rotate90(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (x * height + (height - 1 - y)) * 4;
      out.set(data.subarray(src, src + 4), dst);
    }
  }
  return { width: height, height: width, data: out };
}

/** Solid or random-noise image with no barcode. */
export function renderNoise(width: number, height: number, seed = 7): RgbaImage {
  const random = seededRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = data[p + 1] = data[p + 2] = random() * 255;
    data[p + 3] = 255;
  }
  return { width, height, data };
}
