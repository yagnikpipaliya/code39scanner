import { InvalidOptionsError } from './errors.js';
import { ScanOrientation } from './types.js';
import { isEnumValue } from './utils/enum.js';

/** Options for decoding a single scanline of bar/space widths. */
export interface DecodeOptions {
  /**
   * Expand Full ASCII shift sequences (`+A` → `a`, `%U` → NUL, …). Payloads that are not valid
   * Full ASCII are returned as plain Code 39. Default `false`.
   */
  readonly fullAscii?: boolean;
  /** Minimum number of data characters (excluding start/stop). Default `1`. */
  readonly minLength?: number;
  /** Minimum quiet zone on each side, in narrow-element widths. Spec is 10; default `5` for tolerance. */
  readonly minQuietZone?: number;
}

/** Options for decoding a whole image. */
export interface ImageDecodeOptions extends DecodeOptions {
  /** Primary scanlines sampled per orientation. Default `24`. */
  readonly scanLines?: number;
  /** Scan directions. Default both, so the barcode may be held horizontally or vertically. */
  readonly orientations?: readonly ScanOrientation[];
  /** Independent scanlines that must agree on a value before it is reported. Default `2`. */
  readonly minConfirmations?: number;
}

/** Per-call options for one decoding pass over an image. */
export interface ScanPassOptions {
  /**
   * Position of the primary scanlines within their band, from `0` to `1`. Default `0.5`
   * (centered). Varying it between frames (as the live scanner does) sweeps the lines across
   * the whole image, so barcodes smaller than the line spacing are still crossed.
   */
  readonly linePhase?: number;
}

/** Number of most recent frames considered when confirming a value across frames. */
export const FRAME_CONFIRMATION_WINDOW = 10;

/** Options for the live camera scanner. */
export interface ScannerOptions extends ImageDecodeOptions {
  /** Minimum delay between frame decodes, in ms. Default `100`. */
  readonly scanIntervalMs?: number;
  /** A barcode is reported again only after being out of view this long, in ms. Default `1500`. */
  readonly presenceTimeoutMs?: number;
  /**
   * Frames, out of the last {@link FRAME_CONFIRMATION_WINDOW}, that must decode a value before it
   * is reported. Default `1` (report on first sight; agreement between independent scanlines
   * already guards against misreads). Higher values add protection against one-frame misreads;
   * misses in between do not reset the count. Independent of `presenceTimeoutMs`.
   */
  readonly minFrameConfirmations?: number;
  /**
   * Frames are downscaled so their longest side is at most this many pixels. Default `1920`
   * (full HD). Each frame is drawn once; only the sampled scanlines are read back and converted,
   * so full resolution costs little memory and keeps small barcodes above the ~1.5 px
   * narrow-element minimum.
   */
  readonly maxFrameSize?: number;
}

export type ResolvedDecodeOptions = Readonly<Required<DecodeOptions>>;
export type ResolvedImageDecodeOptions = Readonly<Required<ImageDecodeOptions>>;
export type ResolvedScannerOptions = Readonly<Required<ScannerOptions>>;

export const DEFAULT_SCANNER_OPTIONS: ResolvedScannerOptions = Object.freeze({
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

interface NumberRule {
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
}

/** Single source of truth for the valid range of every numeric option. */
const NUMBER_RULES = {
  minLength: { min: 1, max: 1000, integer: true },
  minQuietZone: { min: 0, max: 100, integer: false },
  scanLines: { min: 1, max: 1000, integer: true },
  minConfirmations: { min: 1, max: 1000, integer: true },
  linePhase: { min: 0, max: 1, integer: false },
  scanIntervalMs: { min: 0, max: 60_000, integer: false },
  presenceTimeoutMs: { min: 0, max: 3_600_000, integer: false },
  minFrameConfirmations: { min: 1, max: FRAME_CONFIRMATION_WINDOW, integer: true },
  maxFrameSize: { min: 64, max: 8192, integer: true },
} as const satisfies Readonly<Record<string, NumberRule>>;

export type NumericOptionName = keyof typeof NUMBER_RULES;

/** Validates a numeric option against its documented range and returns it. */
export function validateNumberOption(name: NumericOptionName, value: unknown): number {
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
function withDefaults(options: ScannerOptions | undefined): ResolvedScannerOptions {
  const defined = Object.entries(options ?? {}).filter(([, value]) => value !== undefined);
  return { ...DEFAULT_SCANNER_OPTIONS, ...Object.fromEntries(defined) };
}

export function resolveDecodeOptions(options?: DecodeOptions): ResolvedDecodeOptions {
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

export function resolveImageDecodeOptions(
  options?: ImageDecodeOptions,
): ResolvedImageDecodeOptions {
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

export function resolveScannerOptions(options?: ScannerOptions): ResolvedScannerOptions {
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
