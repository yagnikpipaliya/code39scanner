import { Code39WidthDecoder, type LineSymbol } from '../core/width-decoder.js';
import {
  resolveImageDecodeOptions,
  validateNumberOption,
  type ImageDecodeOptions,
  type ResolvedImageDecodeOptions,
  type ScanPassOptions,
} from '../options.js';
import { ScanOrientation, type DecodedBarcode } from '../types.js';
import { toLuminanceSource, type ImageInput, type LuminanceSource } from './luminance.js';
import { binarizeLine } from './scanline-binarizer.js';

/** Primary lines sit in the middle of their band unless a phase is given. */
const DEFAULT_LINE_PHASE = 0.5;

/**
 * Minimum distance between two scanlines that count as independent confirmations, in narrow
 * bar widths (modules) of the symbol.
 *
 * Lines this far apart sample different pixels of the bars, so a pattern that decodes on a single
 * pixel row (sensor noise, a text stroke) is not confirmed by its immediate neighbours. Tying the
 * distance to the module size, not the symbol length, keeps the tilt tolerance close to the
 * physical limit: a tilted barcode only needs to be crossed end to end by two lines a few modules
 * apart, not by lines a fixed fraction of its length apart.
 */
const MIN_CONFIRMATION_SPACING_MODULES = 3;

/** Evenly spaced primary line positions across `length`, ordered from the center outwards. */
function primaryLinePositions(count: number, length: number, phase: number): number[] {
  const lines = Math.min(count, length);
  const center = (length - 1) / 2;
  return Array.from({ length: lines }, (_, k) =>
    Math.min(length - 1, Math.floor(((k + phase) * length) / lines)),
  ).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
}

/** Positions `step` apart, walking from `position` (exclusive) towards one image edge. */
function* walkFrom(position: number, step: number, length: number): Generator<number> {
  for (let next = position + step; next >= 0 && next < length; next += step) yield next;
}

/** Size of the largest subset of sorted `positions` whose members are `spacing` or more apart. */
function countIndependent(positions: readonly number[], spacing: number): number {
  let count = 0;
  let last = -Infinity;
  for (const position of positions) {
    if (position - last >= spacing) {
      count++;
      last = position;
    }
  }
  return count;
}

/**
 * Tracks the scanlines supporting each decoded value and how many of them are independent.
 *
 * Support is grouped by value *and* confirmation spacing (i.e. symbol size), so two labels with
 * the same text but different sizes are confirmed independently, each at its own spacing.
 */
class ConfirmationLedger {
  /** `${spacing}:${rawText}` → orientation → supporting line positions. */
  readonly #groups = new Map<string, Map<ScanOrientation, Set<number>>>();

  /** Records a supporting line; returns the number of mutually independent supporting lines. */
  add(rawText: string, spacing: number, orientation: ScanOrientation, position: number): number {
    const key = `${spacing}:${rawText}`;
    let lines = this.#groups.get(key);
    if (!lines) {
      lines = new Map();
      this.#groups.set(key, lines);
    }
    let positions = lines.get(orientation);
    if (!positions) {
      positions = new Set();
      lines.set(orientation, positions);
    }
    positions.add(position);

    let independent = 0;
    for (const linePositions of lines.values()) {
      independent += countIndependent(
        [...linePositions].sort((a, b) => a - b),
        spacing,
      );
    }
    return independent;
  }
}

/**
 * Finds Code 39 barcodes by sampling scanlines in one or both orientations.
 *
 * A value is reported only after `minConfirmations` independent scanlines agree on it (see
 * {@link MIN_CONFIRMATION_SPACING_MODULES}). When a primary line decodes a value, the decoder
 * walks along the bars in both directions, line by line at that spacing, until the value stops
 * decoding — so a barcode crossed by a single primary line still confirms, up to as many
 * independent lines as its bars are tall.
 */
export class Code39ImageDecoder {
  readonly #options: ResolvedImageDecodeOptions;
  readonly #lineDecoder: Code39WidthDecoder;

  constructor(options?: ImageDecodeOptions) {
    this.#options = resolveImageDecodeOptions(options);
    this.#lineDecoder = new Code39WidthDecoder(this.#options);
  }

  /** The first confirmed barcode, or `null`. */
  decode(input: ImageInput, pass?: ScanPassOptions): DecodedBarcode | null {
    return this.#scan(toLuminanceSource(input), pass, true)[0] ?? null;
  }

  /** All distinct confirmed barcodes. */
  decodeAll(input: ImageInput, pass?: ScanPassOptions): DecodedBarcode[] {
    return this.#scan(toLuminanceSource(input), pass, false);
  }

  #scan(
    source: LuminanceSource,
    pass: ScanPassOptions = {},
    stopAtFirst: boolean,
  ): DecodedBarcode[] {
    const phase = validateNumberOption('linePhase', pass.linePhase ?? DEFAULT_LINE_PHASE);
    if (source.width === 0 || source.height === 0) return [];

    const { orientations, scanLines, minConfirmations } = this.#options;
    const ledger = new ConfirmationLedger();
    const confirmed = new Map<string, DecodedBarcode>();

    for (const orientation of orientations) {
      const horizontal = orientation === ScanOrientation.Horizontal;
      const length = horizontal ? source.height : source.width;
      const decodeLine = this.#cachedLineDecoder((position) =>
        horizontal ? source.row(position) : source.column(position),
      );
      const decodes = (position: number, rawText: string) =>
        decodeLine(position).some((symbol) => symbol.barcode.rawText === rawText);

      for (const position of primaryLinePositions(scanLines, length, phase)) {
        for (const { barcode, moduleWidth } of decodeLine(position)) {
          const { rawText } = barcode;
          if (confirmed.has(rawText)) continue;

          const spacing = Math.max(1, Math.round(moduleWidth * MIN_CONFIRMATION_SPACING_MODULES));
          let support = ledger.add(rawText, spacing, orientation, position);
          // Walk along the bars in both directions until the value stops decoding.
          for (const step of [-spacing, spacing]) {
            for (const probe of walkFrom(position, step, length)) {
              if (support >= minConfirmations || !decodes(probe, rawText)) break;
              support = ledger.add(rawText, spacing, orientation, probe);
            }
          }
          if (support >= minConfirmations) {
            confirmed.set(rawText, barcode);
            if (stopAtFirst) return [...confirmed.values()];
          }
        }
      }
    }
    return [...confirmed.values()];
  }

  /** Decodes lines of one orientation, each position at most once. */
  #cachedLineDecoder(
    readLine: (position: number) => Uint8Array,
  ): (position: number) => readonly LineSymbol[] {
    const cache = new Map<number, readonly LineSymbol[]>();
    return (position) => {
      let symbols = cache.get(position);
      if (!symbols) {
        const runs = binarizeLine(readLine(position));
        symbols = runs ? this.#lineDecoder.decodeSymbols(runs) : [];
        cache.set(position, symbols);
      }
      return symbols;
    };
  }
}

/**
 * Convenience wrapper: decodes the first confirmed Code 39 barcode in an image.
 * Prefer a reused {@link Code39ImageDecoder} when decoding many images.
 */
export function decodeImage(
  input: ImageInput,
  options?: ImageDecodeOptions,
): DecodedBarcode | null {
  return new Code39ImageDecoder(options).decode(input);
}
