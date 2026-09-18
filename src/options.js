import { InvalidOptionsError } from './errors.js';
import { ScanOrientation } from './types.js';
import { isEnumValue } from './utils.js';

/**
 * Options for decoding a single scanline of bar/space widths.
 * @typedef {object} DecodeOptions
 * @property {boolean} [fullAscii] Expand Full ASCII shift sequences (`+A` → `a`, `%U` → NUL, …).
 *   Payloads that are not valid Full ASCII are returned as plain Code 39. Default `false`.
 * @property {number} [minLength] Minimum number of data characters (excluding start/stop).
 *   Default `1`.
 * @property {number} [minQuietZone] Minimum quiet zone on each side, in narrow-element widths.
 *   Spec is 10; default `5` for tolerance.
 */

/**
 * Options for decoding a whole image: {@link DecodeOptions} plus
 * - `scanLines`: primary scanlines sampled per orientation. Default `24`.
 * - `orientations`: {@link ScanOrientation} values to scan. Default both, so the barcode may be
 *   held horizontally or vertically.
 * - `minConfirmations`: independent scanlines that must agree on a value before it is reported.
 *   Default `2`.
 * @typedef {DecodeOptions & {
 *   scanLines?: number,
 *   orientations?: readonly string[],
 *   minConfirmations?: number,
 * }} ImageDecodeOptions
 */

/**
 * Per-call options for one decoding pass over an image.
 * @typedef {object} ScanPassOptions
 * @property {number} [linePhase] Position of the primary scanlines within their band, from `0`
 *   to `1`. Default `0.5` (centered). Varying it between frames (as the live scanner does)
 *   sweeps the lines across the whole image, so barcodes smaller than the line spacing are still
 *   crossed.
 */

/** Number of most recent frames considered when confirming a value across frames. */
export const FRAME_CONFIRMATION_WINDOW = 10;

/**
 * Options for the live camera scanner: {@link ImageDecodeOptions} plus
 * - `scanIntervalMs`: minimum delay between frame decodes, in ms. Default `100`.
 * - `presenceTimeoutMs`: a barcode is reported again only after being out of view this long,
 *   in ms. Default `1500`.
 * - `minFrameConfirmations`: frames, out of the last {@link FRAME_CONFIRMATION_WINDOW}, that
 *   must decode a value before it is reported. Default `1` (report on first sight; agreement
 *   between independent scanlines already guards against misreads). Higher values add
 *   protection against one-frame misreads; misses in between do not reset the count.
 *   Independent of `presenceTimeoutMs`.
 * - `maxFrameSize`: frames are downscaled so their longest side is at most this many pixels.
 *   Default `1920` (full HD). Each frame is drawn once; only the sampled scanlines are read back
 *   and converted, so full resolution costs little memory and keeps small barcodes above the
 *   ~1.5 px narrow-element minimum.
 * @typedef {ImageDecodeOptions & {
 *   scanIntervalMs?: number,
 *   presenceTimeoutMs?: number,
 *   minFrameConfirmations?: number,
 *   maxFrameSize?: number,
 * }} ScannerOptions
 */

/** @typedef {Readonly<Required<DecodeOptions>>} ResolvedDecodeOptions */
/** @typedef {Readonly<Required<ImageDecodeOptions>>} ResolvedImageDecodeOptions */
/** @typedef {Readonly<Required<ScannerOptions>>} ResolvedScannerOptions */

/** @type {ResolvedScannerOptions} */
export const DEFAULT_SCANNER_OPTIONS = Object.freeze({
  fullAscii: false,
  minLength: 1,
  minQuietZone: 5,
  scanLines: 24,
  orientations: Object.freeze([ScanOrientation.Horizontal, ScanOrientation.Vertical]),
  minConfirmations: 2,
  scanIntervalMs: 100,
  presenceTimeoutMs: 1500,
  minFrameConfirmations: 1,
  maxFrameSize: 1920,
});

/**
 * Single source of truth for the valid range of every numeric option.
 * @type {Readonly<Record<string, { min: number, max: number, integer: boolean }>>}
 */
const NUMBER_RULES = Object.freeze({
  minLength: { min: 1, max: 1000, integer: true },
  minQuietZone: { min: 0, max: 100, integer: false },
  scanLines: { min: 1, max: 1000, integer: true },
  // Reachable on any ordinary barcode (the walk along the bars supplies the lines); higher values
  // would only reject real barcodes.
  minConfirmations: { min: 1, max: 10, integer: true },
  linePhase: { min: 0, max: 1, integer: false },
  scanIntervalMs: { min: 0, max: 60_000, integer: false },
  presenceTimeoutMs: { min: 0, max: 3_600_000, integer: false },
  minFrameConfirmations: { min: 1, max: FRAME_CONFIRMATION_WINDOW, integer: true },
  maxFrameSize: { min: 64, max: 8192, integer: true },
});

/**
 * Validates a numeric option against its documented range and returns it.
 * @param {string} name One of the `NUMBER_RULES` keys.
 * @param {unknown} value
 * @returns {number}
 */
export function validateNumberOption(name, value) {
  const { min, max, integer } = NUMBER_RULES[name];
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value));
  if (!valid) {
    const kind = integer ? 'an integer' : 'a number';
    throw new InvalidOptionsError(`"${name}" must be ${kind} between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Defaults overlaid with the caller's options; explicit `undefined` values keep the default.
 * @param {ScannerOptions | undefined} options
 * @returns {ResolvedScannerOptions}
 */
function withDefaults(options) {
  const defined = Object.entries(options ?? {}).filter(([, value]) => value !== undefined);
  return { ...DEFAULT_SCANNER_OPTIONS, ...Object.fromEntries(defined) };
}

/**
 * @param {DecodeOptions} [options]
 * @returns {ResolvedDecodeOptions}
 */
export function resolveDecodeOptions(options) {
  const { fullAscii, minLength, minQuietZone } = withDefaults(options);
  if (typeof fullAscii !== 'boolean') {
    throw new InvalidOptionsError('"fullAscii" must be a boolean.');
  }
  return Object.freeze({
    fullAscii,
    minLength: validateNumberOption('minLength', minLength),
    minQuietZone: validateNumberOption('minQuietZone', minQuietZone),
  });
}

/**
 * @param {ImageDecodeOptions} [options]
 * @returns {ResolvedImageDecodeOptions}
 */
export function resolveImageDecodeOptions(options) {
  const { scanLines, orientations, minConfirmations } = withDefaults(options);
  const validScanLines = validateNumberOption('scanLines', scanLines);
  const validOrientations =
    Array.isArray(orientations) &&
    orientations.length > 0 &&
    orientations.every((orientation) => isEnumValue(ScanOrientation, orientation));
  if (!validOrientations) {
    const allowed = Object.values(ScanOrientation)
      .map((orientation) => `"${orientation}"`)
      .join(', ');
    throw new InvalidOptionsError(`"orientations" must be a non-empty array of ${allowed}.`);
  }
  const uniqueOrientations = Object.freeze([...new Set(orientations)]);
  return Object.freeze({
    ...resolveDecodeOptions(options),
    scanLines: validScanLines,
    orientations: uniqueOrientations,
    minConfirmations: validateNumberOption('minConfirmations', minConfirmations),
  });
}

/**
 * @param {ScannerOptions} [options]
 * @returns {ResolvedScannerOptions}
 */
export function resolveScannerOptions(options) {
  const { scanIntervalMs, presenceTimeoutMs, minFrameConfirmations, maxFrameSize } =
    withDefaults(options);
  return Object.freeze({
    ...resolveImageDecodeOptions(options),
    scanIntervalMs: validateNumberOption('scanIntervalMs', scanIntervalMs),
    presenceTimeoutMs: validateNumberOption('presenceTimeoutMs', presenceTimeoutMs),
    minFrameConfirmations: validateNumberOption('minFrameConfirmations', minFrameConfirmations),
    maxFrameSize: validateNumberOption('maxFrameSize', maxFrameSize),
  });
}
