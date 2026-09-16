import { InvalidOptionsError } from './errors.js';
import { ScanOrientation } from './types.js';
import { isEnumValue } from './utils.js';

/** Options for decoding a single scanline of bar/space widths. */
/**
 * @typedef {{
 *   readonly fullAscii?: boolean;
 *   readonly minLength?: number;
 *   readonly minQuietZone?: number;
 * }} DecodeOptions
 */

/** Options for decoding a whole image. */
/**
 * @typedef {DecodeOptions & {
 *   readonly scanLines?: number;
 *   readonly orientations?: readonly ScanOrientation[];
 *   readonly minConfirmations?: number;
 * }} ImageDecodeOptions
 */

/** Per-call options for one decoding pass over an image. */
/**
 * @typedef {{
 *   readonly linePhase?: number;
 * }} ScanPassOptions
 */

/** Number of most recent frames considered when confirming a value across frames. */
export const FRAME_CONFIRMATION_WINDOW = 10;

/** Options for the live camera scanner. */
/**
 * @typedef {ImageDecodeOptions & {
 *   readonly scanIntervalMs?: number;
 *   readonly presenceTimeoutMs?: number;
 *   readonly minFrameConfirmations?: number;
 *   readonly maxFrameSize?: number;
 * }} ScannerOptions
 */

/** @typedef {Required<DecodeOptions>} ResolvedDecodeOptions */
/** @typedef {Required<ImageDecodeOptions>} ResolvedImageDecodeOptions */
/** @typedef {Required<ScannerOptions>} ResolvedScannerOptions */

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

/** @typedef {{ readonly min: number, readonly max: number, readonly integer: boolean }} NumberRule */

/** Single source of truth for the valid range of every numeric option. */
const NUMBER_RULES = {
  minLength: { min: 1, max: 1000, integer: true },
  minQuietZone: { min: 0, max: 100, integer: false },
  scanLines: { min: 1, max: 1000, integer: true },
  minConfirmations: { min: 1, max: 10, integer: true },
  linePhase: { min: 0, max: 1, integer: false },
  scanIntervalMs: { min: 0, max: 60_000, integer: false },
  presenceTimeoutMs: { min: 0, max: 3_600_000, integer: false },
  minFrameConfirmations: { min: 1, max: FRAME_CONFIRMATION_WINDOW, integer: true },
  maxFrameSize: { min: 64, max: 8192, integer: true },
};

/** @typedef {keyof typeof NUMBER_RULES} NumericOptionName */

/** Validates a numeric option against its documented range and returns it. */
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

/** Defaults overlaid with the caller's options; explicit `undefined` values keep the default. */
function withDefaults(options) {
  const defined = Object.entries(options ?? {}).filter(([, value]) => value !== undefined);
  return { ...DEFAULT_SCANNER_OPTIONS, ...Object.fromEntries(defined) };
}

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