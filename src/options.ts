import { InvalidOptionsError } from './errors.js';
import type { ScanOrientation } from './types.js';

/** Options for decoding a single scanline of bar/space widths. */
export interface DecodeOptions {
  /** Expand Full ASCII shift sequences (`+A` → `a`, `%U` → NUL, …). Default `false`. */
  readonly fullAscii?: boolean;
  /** Minimum number of data characters (excluding start/stop). Default `1`. */
  readonly minLength?: number;
  /** Minimum quiet zone on each side, in narrow-element widths. Spec is 10; default `5` for tolerance. */
  readonly minQuietZone?: number;
}

/** Options for decoding a whole image. */
export interface ImageDecodeOptions extends DecodeOptions {
  /** Scanlines sampled per orientation. Default `24`. */
  readonly scanLines?: number;
  /** Scan directions. Default both, so the barcode may be held horizontally or vertically. */
  readonly orientations?: readonly ScanOrientation[];
  /** Scanlines that must agree on a value before it is reported. Default `2`. */
  readonly minConfirmations?: number;
}

/** Options for the live camera scanner. */
export interface ScannerOptions extends ImageDecodeOptions {
  /** Minimum delay between frame decodes, in ms. Default `100`. */
  readonly scanIntervalMs?: number;
  /** A barcode is reported again only after being out of view this long, in ms. Default `1500`. */
  readonly presenceTimeoutMs?: number;
  /**
   * Frames are downscaled so their longest side is at most this many pixels. Default `1920`
   * (full HD). Only sampled scanlines are processed, so full resolution stays cheap and keeps
   * small barcodes above the ~1.5 px narrow-element minimum.
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
  orientations: Object.freeze(['horizontal', 'vertical'] as const),
  minConfirmations: 2,
  scanIntervalMs: 100,
  presenceTimeoutMs: 1500,
  maxFrameSize: 1920,
});

const ORIENTATIONS: readonly ScanOrientation[] = ['horizontal', 'vertical'];

/** Defaults overlaid with the caller's options; explicit `undefined` values keep the default. */
function withDefaults(options: ScannerOptions | undefined): ResolvedScannerOptions {
  const defined = Object.entries(options ?? {}).filter(([, value]) => value !== undefined);
  return { ...DEFAULT_SCANNER_OPTIONS, ...Object.fromEntries(defined) };
}

function assertNumber(name: string, value: number, min: number, max: number, integer: boolean) {
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
}

export function resolveDecodeOptions(options?: DecodeOptions): ResolvedDecodeOptions {
  const { fullAscii, minLength, minQuietZone } = withDefaults(options);
  if (typeof fullAscii !== 'boolean') {
    throw new InvalidOptionsError('"fullAscii" must be a boolean.');
  }
  assertNumber('minLength', minLength, 1, 1000, true);
  assertNumber('minQuietZone', minQuietZone, 0, 100, false);
  return Object.freeze({ fullAscii, minLength, minQuietZone });
}

export function resolveImageDecodeOptions(
  options?: ImageDecodeOptions,
): ResolvedImageDecodeOptions {
  const { scanLines, orientations, minConfirmations } = withDefaults(options);
  assertNumber('scanLines', scanLines, 1, 1000, true);
  const validOrientations =
    Array.isArray(orientations) &&
    orientations.length > 0 &&
    orientations.every((o) => ORIENTATIONS.includes(o));
  if (!validOrientations) {
    throw new InvalidOptionsError(
      `"orientations" must be a non-empty array of ${ORIENTATIONS.map((o) => `"${o}"`).join(', ')}.`,
    );
  }
  const uniqueOrientations = Object.freeze([...new Set(orientations)]);
  assertNumber(
    'minConfirmations',
    minConfirmations,
    1,
    scanLines * uniqueOrientations.length,
    true,
  );
  return Object.freeze({
    ...resolveDecodeOptions(options),
    scanLines,
    orientations: uniqueOrientations,
    minConfirmations,
  });
}

export function resolveScannerOptions(options?: ScannerOptions): ResolvedScannerOptions {
  const { scanIntervalMs, presenceTimeoutMs, maxFrameSize } = withDefaults(options);
  assertNumber('scanIntervalMs', scanIntervalMs, 0, 60_000, false);
  assertNumber('presenceTimeoutMs', presenceTimeoutMs, 0, 3_600_000, false);
  assertNumber('maxFrameSize', maxFrameSize, 64, 8192, true);
  return Object.freeze({
    ...resolveImageDecodeOptions(options),
    scanIntervalMs,
    presenceTimeoutMs,
    maxFrameSize,
  });
}
