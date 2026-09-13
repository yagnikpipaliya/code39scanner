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
 * Minimum distance between two scanlines that count as independent confirmations, as a
 * fraction of the symbol length.
 *
 * ISO/IEC 16388 requires Code 39 bars to be at least 15% of the symbol length tall; this is a
 * third of that, leaving room for tilt and cropping. Agreeing lines therefore cross genuinely
 * different parts of the bars, so a pattern that decodes on only a few adjacent pixel rows
 * (text, textures) is never confirmed — while a real barcode confirms however few primary
 * lines cross it.
 */
const MIN_CONFIRMATION_SPACING_RATIO = 0.05;
/** Around a hit, lines are probed at these multiples of the confirmation spacing. */
const PROBE_MULTIPLES = [1, 2] as const;

/** Evenly spaced primary line positions across `length`, ordered from the center outwards. */
function primaryLinePositions(count: number, length: number, phase: number): number[] {
  const lines = Math.min(count, length);
  const center = (length - 1) / 2;
  return Array.from({ length: lines }, (_, k) =>
    Math.min(length - 1, Math.floor(((k + phase) * length) / lines)),
  ).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
}

function* probePositions(position: number, spacing: number, length: number): Generator<number> {
  for (const multiple of PROBE_MULTIPLES) {
    for (const candidate of [position - multiple * spacing, position + multiple * spacing]) {
      if (candidate >= 0 && candidate < length) yield candidate;
    }
  }
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

/** Tracks the scanlines supporting each decoded value and how many of them are independent. */
class ConfirmationLedger {
  readonly #entries = new Map<
    string,
    { readonly spacing: number; readonly lines: Map<ScanOrientation, Set<number>> }
  >();

  /** Records a supporting line; returns the number of mutually independent supporting lines. */
  add(rawText: string, spacing: number, orientation: ScanOrientation, position: number): number {
    let entry = this.#entries.get(rawText);
    if (!entry) {
      entry = { spacing, lines: new Map() };
      this.#entries.set(rawText, entry);
    }
    let positions = entry.lines.get(orientation);
    if (!positions) {
      positions = new Set();
      entry.lines.set(orientation, positions);
    }
    positions.add(position);

    let independent = 0;
    for (const linePositions of entry.lines.values()) {
      const sorted = [...linePositions].sort((a, b) => a - b);
      independent += countIndependent(sorted, entry.spacing);
    }
    return independent;
  }
}

/**
 * Finds Code 39 barcodes by sampling scanlines in one or both orientations.
 *
 * A value is reported only after `minConfirmations` independent scanlines agree on it (see
 * {@link MIN_CONFIRMATION_SPACING_RATIO}). When a primary line decodes a value, lines at that
 * spacing are probed as well, so barcodes crossed by a single primary line still confirm.
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
    const { orientations, scanLines, minConfirmations } = this.#options;
    const ledger = new ConfirmationLedger();
    const confirmed = new Map<string, DecodedBarcode>();

    for (const orientation of orientations) {
      const horizontal = orientation === ScanOrientation.Horizontal;
      const length = horizontal ? source.height : source.width;
      const decodeLine = this.#cachedLineDecoder((position) =>
        horizontal ? source.row(position) : source.column(position),
      );

      for (const position of primaryLinePositions(scanLines, length, phase)) {
        for (const { barcode, length: symbolLength } of decodeLine(position)) {
          const { rawText } = barcode;
          if (confirmed.has(rawText)) continue;

          const spacing = Math.max(1, Math.round(symbolLength * MIN_CONFIRMATION_SPACING_RATIO));
          let support = ledger.add(rawText, spacing, orientation, position);
          for (const probe of probePositions(position, spacing, length)) {
            if (support >= minConfirmations) break;
            if (decodeLine(probe).some((symbol) => symbol.barcode.rawText === rawText)) {
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
