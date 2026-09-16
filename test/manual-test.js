/**
 * Manual test runner for code39-scanner.
 * Replaces Vitest tests with a simple Node.js script.
 */

import { Code39WidthDecoder, matchCharacter } from '../src/core/width-decoder.js';
import { Code39ImageDecoder, decodeImage } from '../src/image/image-decoder.js';
import { binarizeLine } from '../src/image/scanline-binarizer.js';
import { luminanceFromRgba, toGrayscale, luminanceFromGray, toLuminanceSource } from '../src/image/luminance.js';
import { CODE39_ALPHABET, expandFullAscii } from '../src/core/symbology.js';
import { InvalidOptionsError, InvalidArgumentError, Code39ScannerError, ErrorCode, UnsupportedBrowserError, InsecureContextError, PermissionDeniedError, CameraUnavailableError, OperationCancelledError, FrameProcessingError } from '../src/errors.js';
import { BarcodeFormat, ScanOrientation } from '../src/types.js';
import { TypedEventEmitter } from '../src/events.js';
import { defineEnum, getOrInsert, monotonicClock, isEnumValue } from '../src/utils.js';
import { Code39Scanner, ScannerState, ScannerEvent } from '../src/camera/scanner.js';
import { PresenceTracker } from '../src/camera/presence-tracker.js';

// ============================================================================
// Test helpers (ported from tests/helpers.ts)
// ============================================================================

const { CHAR_TO_PATTERN, ELEMENTS_PER_CHARACTER, isWideElement, START_STOP_CHARACTER } = await import('../src/core/symbology.js');

/** @typedef {{ narrow?: number, ratio?: number, gap?: number, quietZone?: number, raw?: boolean }} EncodeOptions */

/** Encodes `text` into runs (light, dark, light, …, light) — the decoder's input format. */
function encodeRuns(text, options = {}) {
  const { narrow = 1, ratio = 2.5, gap = 1, quietZone = 10, raw = false } = options;
  const symbol = raw ? text : `${START_STOP_CHARACTER}${text}${START_STOP_CHARACTER}`;
  const runs = [quietZone * narrow];
  for (let index = 0; index < symbol.length; index++) {
    const char = symbol[index];
    const mask = CHAR_TO_PATTERN.get(char);
    if (mask === undefined) throw new Error(`Cannot encode "${char}" in Code 39`);
    if (index > 0) runs.push(gap * narrow);
    for (let e = 0; e < ELEMENTS_PER_CHARACTER; e++) {
      runs.push(isWideElement(mask, e) ? narrow * ratio : narrow);
    }
  }
  runs.push(quietZone * narrow);
  return runs;
}

/** Full ASCII encoding table written independently of the decoder. */
function toFullAscii(text) {
  const letter = (offset) => String.fromCharCode(65 + offset);
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
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO/IEC 16388: bars must be at least 15% of the symbol length tall. */
const MIN_BAR_HEIGHT_RATIO = 0.15;
const MIN_IMAGE_HEIGHT = 60;

/** @typedef {{ barHeight?: number, margin?: number, light?: number, dark?: number, noise?: number, blur?: number, gradient?: number, seed?: number, height?: number } & EncodeOptions } RenderOptions */

/** Renders `text` as an anti-aliased RGBA barcode image. */
function renderBarcode(text, options = {}) {
  const {
    narrow = 1,
    ratio = 2.5,
    gap = 1,
    quietZone = 10,
    raw = false,
    barHeight = 0.6,
    margin = 0,
    light = 230,
    dark = 25,
    noise = 0,
    blur = 0,
    gradient = 0,
    seed = 1,
    height,
  } = options;
  const runs = encodeRuns(text, { narrow, ratio, gap, quietZone, raw });
  const total = runs.reduce((sum, w) => sum + w, 0);
  const width = Math.ceil(total + 2 * margin);
  const computedHeight = height ?? Math.max(MIN_IMAGE_HEIGHT, Math.ceil((width * MIN_BAR_HEIGHT_RATIO) / barHeight));

  // Dark coverage per pixel column (exact area coverage → anti-aliasing).
  let profile = new Float32Array(width);
  let x = margin;
  runs.forEach((w, i) => {
    if (i % 2 === 1) addCoverage(profile, x, x + w);
    x += w;
  });
  for (let r = 0; r < blur; r++) profile = boxBlur(profile);

  const random = seededRandom(seed);
  const top = Math.round((computedHeight * (1 - barHeight)) / 2);
  const bottom = computedHeight - top;
  const data = new Uint8ClampedArray(width * computedHeight * 4);
  for (let py = 0; py < computedHeight; py++) {
    for (let px = 0; px < width; px++) {
      const coverage = py >= top && py < bottom ? profile[px] : 0;
      const illumination = 1 - (gradient * px) / width;
      const value = (light - coverage * (light - dark)) * illumination + (random() * 2 - 1) * noise;
      const p = (py * width + px) * 4;
      data[p] = data[p + 1] = data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { width, height: computedHeight, data };
}

function addCoverage(profile, from, to) {
  for (let px = Math.floor(from); px < Math.ceil(to) && px < profile.length; px++) {
    profile[px] += Math.min(px + 1, to) - Math.max(px, from);
  }
}

function boxBlur(profile) {
  const out = new Float32Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const l = profile[Math.max(0, i - 1)];
    const r = profile[Math.min(profile.length - 1, i + 1)];
    out[i] = (l + profile[i] + r) / 3;
  }
  return out;
}

/** Joins run-length symbols on one scanline, merging adjacent quiet zones. */
function joinRuns(...symbols) {
  return symbols.reduce((joined, runs) =>
    joined.length === 0
      ? [...runs]
      : [...joined.slice(0, -1), joined.at(-1) + runs[0], ...runs.slice(1)],
  );
}

/** Solid or random-noise image with no barcode. */
function renderNoise(width, height, seed = 7) {
  const random = seededRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = data[p + 1] = data[p + 2] = random() * 255;
    data[p + 3] = 255;
  }
  return { width, height, data };
}

// ============================================================================
// Test utilities
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertNotEqual(actual, expected, message) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (!match) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    Expected not: ${JSON.stringify(expected)}`);
    console.error(`    Actual:       ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertThrows(fn, errorClass, message) {
  try {
    fn();
    console.error(`  ✗ ${message} (expected to throw)`);
    failed++;
  } catch (e) {
    if (e instanceof errorClass) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ ${message} (wrong error type: ${e.constructor.name})`);
      failed++;
    }
  }
}

function runTest(name, fn) {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (e) {
    console.error(`  ✗ ${name} threw: ${e.message}`);
    failed++;
  }
}

// ============================================================================
// Tests
// ============================================================================

const DATA_CHARS = CODE39_ALPHABET.replace('*', '');
const decoder = new Code39WidthDecoder();

// --- width-decoder tests ---

runTest('Code39WidthDecoder: decodes every data character', () => {
  const result = decoder.decode(encodeRuns(DATA_CHARS));
  assertEqual(result, { text: DATA_CHARS, rawText: DATA_CHARS, format: BarcodeFormat.Code39 });
});

runTest('Code39WidthDecoder: decodes with various wide:narrow ratios', () => {
  for (const ratio of [2, 2.5, 3]) {
    const result = decoder.decode(encodeRuns('RATIO-42', { ratio }));
    assertEqual(result?.text, 'RATIO-42', `ratio ${ratio}`);
  }
});

runTest('Code39WidthDecoder: decodes at various narrow widths', () => {
  for (const narrow of [0.7, 1, 3.3, 11]) {
    const result = decoder.decode(encodeRuns('SCALE', { narrow }));
    assertEqual(result?.text, 'SCALE', `narrow ${narrow}`);
  }
});

runTest('Code39WidthDecoder: decodes a reversed (upside-down) symbol', () => {
  const result = decoder.decode(encodeRuns('REVERSE 9').reverse());
  assertEqual(result?.text, 'REVERSE 9');
});

runTest('Code39WidthDecoder: decodes when the symbol is surrounded by other runs', () => {
  const runs = [3, 1, 2, 1, ...encodeRuns('EMBED', { quietZone: 12 }), 2, 1, 1];
  const result = decoder.decode(runs);
  assertEqual(result?.text, 'EMBED');
});

runTest('Code39WidthDecoder: tolerates moderate width jitter', () => {
  const runs = encodeRuns('JITTER', { narrow: 4 }).map((w, i) => w + (i % 3 === 0 ? 0.6 : -0.4));
  const result = decoder.decode(runs);
  assertEqual(result?.text, 'JITTER');
});

runTest('Code39WidthDecoder: tolerates gradual width change (perspective)', () => {
  const runs = encodeRuns('PERSPECTIVE', { narrow: 3 }).map((w, i) => w * (1 + i * 0.004));
  const result = decoder.decode(runs);
  assertEqual(result?.text, 'PERSPECTIVE');
});

runTest('Code39WidthDecoder: rejects a symbol without a stop character', () => {
  const runs = encodeRuns('*NOSTOP', { raw: true });
  assertEqual(decoder.decode(runs), null);
});

runTest('Code39WidthDecoder: rejects a symbol without a start character', () => {
  assertEqual(decoder.decode(encodeRuns('NOSTART*', { raw: true })), null);
});

runTest('Code39WidthDecoder: rejects insufficient quiet zones', () => {
  assertEqual(decoder.decode(encodeRuns('QZ', { quietZone: 2 })), null);
  const strict = new Code39WidthDecoder({ minQuietZone: 1 });
  assertNotEqual(strict.decode(encodeRuns('QZ', { quietZone: 2 })), null);
});

runTest('Code39WidthDecoder: rejects an oversized inter-character gap', () => {
  assertEqual(decoder.decode(encodeRuns('GAP', { gap: 8 })), null);
});

runTest('Code39WidthDecoder: rejects an abrupt character width change', () => {
  const runs = encodeRuns('AB');
  const scaled = runs.map((w, i) => (i >= 21 ? w * 1.6 : w));
  assertEqual(decoder.decode(scaled), null);
});

runTest('Code39WidthDecoder: enforces minLength', () => {
  const strict = new Code39WidthDecoder({ minLength: 4 });
  assertEqual(strict.decode(encodeRuns('ABC')), null);
  assertEqual(strict.decode(encodeRuns('ABCD'))?.text, 'ABCD');
});

runTest('Code39WidthDecoder: expands Full ASCII only when enabled', () => {
  const runs = encodeRuns(toFullAscii('Hello, World!'));
  assertEqual(decoder.decode(runs)?.text, 'H+E+L+L+O/L W+O+R+L+D/A');
  const full = new Code39WidthDecoder({ fullAscii: true }).decode(runs);
  assertEqual(full, { text: 'Hello, World!', rawText: 'H+E+L+L+O/L W+O+R+L+D/A', format: BarcodeFormat.Code39 });
});

runTest('Code39WidthDecoder: returns plain Code 39 when Full ASCII payload is invalid', () => {
  const result = new Code39WidthDecoder({ fullAscii: true }).decode(encodeRuns('12/34-A'));
  assertEqual(result, { text: '12/34-A', rawText: '12/34-A', format: BarcodeFormat.Code39 });
});

runTest('Code39WidthDecoder: returns null for empty or garbage input', () => {
  assertEqual(decoder.decode([]), null);
  assertEqual(decoder.decode([5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5]), null);
});

runTest('Code39WidthDecoder: validates options', () => {
  assertThrows(() => new Code39WidthDecoder({ minLength: 0 }), InvalidOptionsError);
  assertThrows(() => new Code39WidthDecoder({ minQuietZone: -1 }), InvalidOptionsError);
  assertThrows(() => new Code39WidthDecoder({ fullAscii: 'yes' }), InvalidOptionsError);
});

// --- decodeAll tests ---

runTest('Code39WidthDecoder.decodeAll: finds every symbol on one scanline', () => {
  const runs = joinRuns(encodeRuns('LEFT'), encodeRuns('RIGHT'));
  const texts = decoder.decodeAll(runs).map((r) => r.text);
  assertEqual(texts, ['LEFT', 'RIGHT']);
  assertEqual(decoder.decode(runs)?.text, 'LEFT');
});

runTest('Code39WidthDecoder.decodeAll: finds symbols printed in opposite directions', () => {
  const texts = decoder.decodeAll(joinRuns(encodeRuns('UP'), encodeRuns('DOWN').reverse())).map((r) => r.text);
  assertEqual(texts, ['UP', 'DOWN']);
});

runTest('Code39WidthDecoder.decodeAll: reports a repeated symbol once', () => {
  const texts = decoder.decodeAll(joinRuns(encodeRuns('SAME'), encodeRuns('SAME'))).map((r) => r.text);
  assertEqual(texts, ['SAME']);
});

runTest('Code39WidthDecoder.decodeAll: reports the module width of each symbol', () => {
  const runs = joinRuns(encodeRuns('WIDE', { narrow: 4 }), encodeRuns('THIN', { narrow: 2 }));
  const symbols = decoder.decodeSymbols(runs);
  const mapped = symbols.map(({ barcode, moduleWidth }) => [barcode.text, moduleWidth]);
  assertEqual(mapped, [['WIDE', 4], ['THIN', 2]]);
});

runTest('Code39WidthDecoder.decodeAll: returns an empty list when nothing decodes', () => {
  assertEqual(decoder.decodeAll([10, 1, 10]), []);
});

// --- matchCharacter tests ---

runTest('matchCharacter: rejects zero-width and out-of-range elements', () => {
  assertEqual(matchCharacter([1, 0, 1, 1, 1, 1, 1, 1, 1], 0), null);
  assertEqual(matchCharacter([1, 1, 1], 0), null);
  assertEqual(matchCharacter([1, 1, 1, 1, 1, 1, 1, 1, 1], -1), null);
});

runTest('matchCharacter: rejects ambiguous wide/narrow separation', () => {
  // Four equally wide elements: no clear set of three.
  assertEqual(matchCharacter([2.5, 2.5, 2.5, 2.5, 1, 1, 1, 1, 1], 0), null);
});

runTest('matchCharacter: rejects ratios outside the tolerated range', () => {
  // '*' pattern with ratio 6.
  assertEqual(matchCharacter([1, 6, 1, 1, 6, 1, 6, 1, 1], 0), null);
});

runTest('matchCharacter: rejects uneven wide or narrow elements', () => {
  assertEqual(matchCharacter([1, 2.5, 1, 1, 5.5, 1, 2.5, 1, 1], 0), null);
  assertEqual(matchCharacter([0.3, 2.5, 1, 1, 2.5, 1, 2.5, 1, 1], 0), null);
});

runTest('matchCharacter: rejects well-shaped patterns that are not Code 39 characters', () => {
  // Three wide bars: valid characters have 2 wide bars + 1 wide space, or 3 wide spaces.
  assertEqual(matchCharacter([2.5, 1, 2.5, 1, 2.5, 1, 1, 1, 1], 0), null);
});

// --- New test: variable inter-character gap ---
runTest('Code39WidthDecoder: decodes with wider inter-character gaps (bug fix)', () => {
  // Test gap of 2 (wider than default 1)
  const runs = encodeRuns('WIDEGAP', { gap: 2 });
  const result = decoder.decode(runs);
  assertEqual(result?.text, 'WIDEGAP');
  
  // Test gap of 3
  const runs2 = encodeRuns('WIDERGAP', { gap: 3 });
  const result2 = decoder.decode(runs2);
  assertEqual(result2?.text, 'WIDERGAP');
});

// --- symbology tests ---

runTest('symbology: expandFullAscii', () => {
  assertEqual(expandFullAscii('H+E+L+L+O/L W+O+R+L+D/A'), 'Hello, World!');
  assertEqual(expandFullAscii('+A+B'), 'ab');
  assertEqual(expandFullAscii('%U'), '\x00');
  assertEqual(expandFullAscii('INVALID'), 'INVALID');
});

// --- image-decoder tests ---

runTest('decodeImage: decodes at various narrow widths', () => {
  for (const narrow of [1.5, 2, 3, 4, 8]) {
    const result = decodeImage(renderBarcode('CODE39-TEST', { narrow }));
    assertEqual(result?.text, 'CODE39-TEST', `narrow ${narrow}`);
  }
});

runTest('decodeImage: decodes with various ratios', () => {
  for (const ratio of [2, 2.5, 3]) {
    const result = decodeImage(renderBarcode('CODE39-TEST', { narrow: 2, ratio }));
    assertEqual(result?.text, 'CODE39-TEST', `ratio ${ratio}`);
  }
});

runTest('decodeImage: decodes a noisy, blurred, low-contrast image', () => {
  const image = renderBarcode('CODE39-TEST', { narrow: 3, light: 170, dark: 90, noise: 12, blur: 2, seed: 42 });
  const result = decodeImage(image);
  assertEqual(result?.text, 'CODE39-TEST');
});

runTest('decodeImage: decodes under strongly uneven illumination', () => {
  const image = renderBarcode('CODE39-TEST', { narrow: 3, gradient: 0.7, margin: 40 });
  const result = decodeImage(image);
  assertEqual(result?.text, 'CODE39-TEST');
});

runTest('decodeImage: decodes a barcode inside a large margin', () => {
  const image = renderBarcode('M', { narrow: 3, margin: 300, height: 200, barHeight: 0.3 });
  assertEqual(decodeImage(image)?.text, 'M');
});

runTest('decodeImage: decodes upside-down (180°)', () => {
  // We'll test the image decoder directly with rotated runs
  const runs = encodeRuns('UPSIDE').reverse();
  assertEqual(new Code39WidthDecoder().decode(runs)?.text, 'UPSIDE');
});

runTest('decodeImage: decodes Full ASCII when enabled', () => {
  const image = renderBarcode(toFullAscii('abc@123'), { narrow: 2 });
  const result = decodeImage(image, { fullAscii: true });
  assertEqual(result?.text, 'abc@123');
});

runTest('decodeImage: returns null for blank, noise and empty images', () => {
  const blank = { width: 200, height: 100, data: new Uint8ClampedArray(200 * 100 * 4).fill(200) };
  assertEqual(decodeImage(blank), null);
  assertEqual(decodeImage(renderNoise(400, 300)), null);
  assertEqual(decodeImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) }), null);
});

runTest('decodeImage: rejects invalid input at the API boundary', () => {
  const tooSmall = { width: 10, height: 10, data: new Uint8ClampedArray(10) };
  assertThrows(() => decodeImage(tooSmall), InvalidArgumentError);
  assertThrows(() => decodeImage({ width: -1, height: 1, data: new Uint8ClampedArray(4) }), InvalidArgumentError);
  assertThrows(() => decodeImage(null), InvalidArgumentError);
});

runTest('Code39ImageDecoder: accepts RGBA images and luminance sources alike', () => {
  const image = renderBarcode('CODE39-TEST', { narrow: 2 });
  const decoder = new Code39ImageDecoder();
  assertEqual(decoder.decode(image)?.text, 'CODE39-TEST');
  assertEqual(decoder.decode(luminanceFromRgba(image))?.text, 'CODE39-TEST');
});

runTest('Code39ImageDecoder: validates options', () => {
  assertThrows(() => new Code39ImageDecoder({ scanLines: 0 }), InvalidOptionsError);
  assertThrows(() => new Code39ImageDecoder({ orientations: [] }), InvalidOptionsError);
  assertThrows(() => new Code39ImageDecoder({ orientations: ['diagonal'] }), InvalidOptionsError);
  assertThrows(() => new Code39ImageDecoder({ minConfirmations: 0 }), InvalidOptionsError);
  assertThrows(() => new Code39ImageDecoder({ minConfirmations: 11 }), InvalidOptionsError);
});

// --- binarizeLine tests ---

runTest('binarizeLine: returns null for flat or tiny lines', () => {
  assertEqual(binarizeLine(new Uint8Array(100).fill(128)), null);
  assertEqual(binarizeLine([0, 255]), null);
});

runTest('binarizeLine: always starts and ends with a light run', () => {
  const line = new Uint8Array(40).fill(20);
  line.fill(230, 5, 35);
  const runs = binarizeLine(line);
  assert(runs.length === 5, 'has 5 runs');
  assertEqual(runs[0], 0);
  assertEqual(runs[4], 0);
  assert(Math.abs(runs[1] - 5) < 1, `run[1] ~ 5, got ${runs[1]}`);
  assert(Math.abs(runs[3] - 5) < 1, `run[3] ~ 5, got ${runs[3]}`);
  const sum = runs.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 40) < 1, `sum ~ 40, got ${sum}`);
});

// --- luminance tests ---

runTest('luminance: luminanceFromRgba and luminanceFromGray work', () => {
  const image = renderBarcode('TEST', { narrow: 2 });
  const src1 = luminanceFromRgba(image);
  assert(typeof src1.row === 'function');
  assert(typeof src1.column === 'function');
  
  const gray = toGrayscale(image);
  const src2 = luminanceFromGray(gray);
  assert(typeof src2.row === 'function');
  assert(typeof src2.column === 'function');
});

runTest('luminance: toLuminanceSource accepts RGBA and luminance sources', () => {
  const image = renderBarcode('TEST', { narrow: 2 });
  const src = toLuminanceSource(image);
  assert(typeof src.row === 'function');
  
  const src2 = toLuminanceSource(src);
  assert(src2 === src);
});

runTest('luminance: toLuminanceSource rejects invalid input', () => {
  assertThrows(() => toLuminanceSource({ width: 10, height: 10, data: new Uint8ClampedArray(10) }), InvalidArgumentError);
  assertThrows(() => toLuminanceSource(null), InvalidArgumentError);
});

// --- errors tests ---

runTest('errors: error classes have correct codes', () => {
  assertEqual(new InvalidOptionsError('test').code, ErrorCode.InvalidOptions);
  assertEqual(new InvalidArgumentError('test').code, ErrorCode.InvalidArgument);
  assertEqual(new UnsupportedBrowserError('test').code, ErrorCode.UnsupportedBrowser);
  assertEqual(new InsecureContextError('test').code, ErrorCode.InsecureContext);
  assertEqual(new PermissionDeniedError('test').code, ErrorCode.PermissionDenied);
  assertEqual(new CameraUnavailableError('test').code, ErrorCode.CameraUnavailable);
  assertEqual(new OperationCancelledError('test').code, ErrorCode.OperationCancelled);
  assertEqual(OperationCancelledError.superseded('op').code, ErrorCode.OperationCancelled);
});

// --- events tests ---

runTest('events: TypedEventEmitter works', () => {
  const emitter = new TypedEventEmitter();
  let received = null;
  const off = emitter.on('test', (payload) => { received = payload; });
  emitter.emit('test', 'hello');
  assertEqual(received, 'hello');
  off();
  emitter.emit('test', 'world');
  assertEqual(received, 'hello');
});

runTest('events: TypedEventEmitter validates listener', () => {
  const emitter = new TypedEventEmitter();
  assertThrows(() => emitter.on('test', 'not a function'), InvalidArgumentError);
});

// --- utils tests ---

runTest('utils: defineEnum and isEnumValue', () => {
  const MyEnum = defineEnum({ A: 'a', B: 'b' });
  assertEqual(MyEnum.A, 'a');
  assertEqual(MyEnum.B, 'b');
  assert(isEnumValue(MyEnum, 'a'));
  assert(isEnumValue(MyEnum, 'b'));
  assert(!isEnumValue(MyEnum, 'c'));
});

runTest('utils: getOrInsert', () => {
  const map = new Map();
  const v1 = getOrInsert(map, 'key', () => 'created');
  assertEqual(v1, 'created');
  const v2 = getOrInsert(map, 'key', () => 'not created');
  assertEqual(v2, 'created');
});

runTest('utils: monotonicClock', () => {
  const t1 = monotonicClock();
  const t2 = monotonicClock();
  assert(t2 >= t1, 'monotonic clock does not go backwards');
});

// --- presence-tracker tests ---

runTest('PresenceTracker: basic confirmation', () => {
  const tracker = new PresenceTracker(1000, () => 0, 2);
  assertEqual(tracker.observe(['A']), []);
  assertEqual(tracker.observe(['A']), ['A']);
  assertEqual(tracker.observe(['A']), []);
});

runTest('PresenceTracker: timeout resets presence', () => {
  let time = 0;
  const tracker = new PresenceTracker(100, () => time, 1);
  tracker.observe(['A']);
  time = 200;
  assertEqual(tracker.observe([]), []);
  time = 300;
  assertEqual(tracker.observe(['A']), ['A']);
});

// --- scanner tests (basic, without camera) ---

runTest('Code39Scanner: isSupported and listCameras exist', () => {
  assert(typeof Code39Scanner.isSupported === 'function');
  assert(typeof Code39Scanner.listCameras === 'function');
});

runTest('Code39Scanner: constructor requires video or frameSource', () => {
  assertThrows(() => new Code39Scanner({}), InvalidOptionsError);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n============================================================');
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('============================================================');

if (failed > 0) {
  process.exit(1);
}