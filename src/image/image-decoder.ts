import { Code39WidthDecoder } from '../core/width-decoder.js';
import {
  resolveImageDecodeOptions,
  validateNumberOption,
  type ImageDecodeOptions,
  type ResolvedImageDecodeOptions,
  type ScanPassOptions,
} from '../options.js';
import { ScanOrientation, type DecodedBarcode, type RgbaImage } from '../types.js';
import { luminanceFromRgba, type LuminanceSource } from './luminance.js';
import { binarizeLine } from './scanline-binarizer.js';

/** Primary lines sit in the middle of their band unless a phase is given. */
const DEFAULT_LINE_PHASE = 0.5;
/** Extra lines probed on each side of a hit, so barcodes thinner than the line spacing confirm. */
const NEIGHBOUR_PROBES_PER_SIDE = 3;
/** Distance between neighbour probes, as a fraction of the primary line spacing. */
const NEIGHBOUR_STEP_FRACTION = 1 / 16;

/** Evenly spaced primary line positions across `length`, ordered from the center outwards. */
function primaryLinePositions(count: number, length: number, phase: number): number[] {
  const lines = Math.min(count, length);
  const center = (length - 1) / 2;
  return Array.from({ length: lines }, (_, k) =>
    Math.min(length - 1, Math.floor(((k + phase) * length) / lines)),
  ).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
}

function* neighbourPositions(position: number, step: number, length: number): Generator<number> {
  for (let i = 1; i <= NEIGHBOUR_PROBES_PER_SIDE; i++) {
    for (const candidate of [position - i * step, position + i * step]) {
      if (candidate >= 0 && candidate < length) yield candidate;
    }
  }
}

/** Records which distinct scanlines decoded each value. Idempotent per line. */
class ScanlineVotes {
  readonly #supporters = new Map<string, Set<string>>();

  /** Adds `lineKey` as a supporter of `rawText`; returns the number of distinct supporters. */
  add(rawText: string, lineKey: string): number {
    let lines = this.#supporters.get(rawText);
    if (!lines) {
      lines = new Set();
      this.#supporters.set(rawText, lines);
    }
    lines.add(lineKey);
    return lines.size;
  }
}

/**
 * Finds Code 39 barcodes by sampling scanlines in one or both orientations.
 *
 * A value is reported only after `minConfirmations` distinct scanlines agree on it, which
 * suppresses false positives. When a primary line decodes a value, nearby lines are probed as
 * well, so barcodes thinner than the primary line spacing can still be confirmed.
 */
export class Code39ImageDecoder {
  readonly #options: ResolvedImageDecodeOptions;
  readonly #lineDecoder: Code39WidthDecoder;

  constructor(options?: ImageDecodeOptions) {
    this.#options = resolveImageDecodeOptions(options);
    this.#lineDecoder = new Code39WidthDecoder(this.#options);
  }

  /** The first confirmed barcode, or `null`. */
  decode(source: LuminanceSource, pass?: ScanPassOptions): DecodedBarcode | null {
    return this.#scan(source, pass, true)[0] ?? null;
  }

  /** All distinct confirmed barcodes. */
  decodeAll(source: LuminanceSource, pass?: ScanPassOptions): DecodedBarcode[] {
    return this.#scan(source, pass, false);
  }

  #scan(
    source: LuminanceSource,
    pass: ScanPassOptions = {},
    stopAtFirst: boolean,
  ): DecodedBarcode[] {
    const phase = validateNumberOption('linePhase', pass.linePhase ?? DEFAULT_LINE_PHASE);
    const { orientations, scanLines, minConfirmations } = this.#options;
    const votes = new ScanlineVotes();
    const confirmed = new Map<string, DecodedBarcode>();

    for (const orientation of orientations) {
      const horizontal = orientation === ScanOrientation.Horizontal;
      const length = horizontal ? source.height : source.width;
      const decodeLine = this.#cachedLineDecoder((position) =>
        horizontal ? source.row(position) : source.column(position),
      );
      const positions = primaryLinePositions(scanLines, length, phase);
      const step = Math.max(1, Math.floor((length / positions.length) * NEIGHBOUR_STEP_FRACTION));

      for (const position of positions) {
        for (const result of decodeLine(position)) {
          const { rawText } = result;
          let support = votes.add(rawText, `${orientation}:${position}`);
          for (const neighbour of neighbourPositions(position, step, length)) {
            if (support >= minConfirmations) break;
            if (decodeLine(neighbour).some((other) => other.rawText === rawText)) {
              support = votes.add(rawText, `${orientation}:${neighbour}`);
            }
          }
          if (support >= minConfirmations && !confirmed.has(rawText)) {
            confirmed.set(rawText, result);
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
  ): (position: number) => readonly DecodedBarcode[] {
    const cache = new Map<number, readonly DecodedBarcode[]>();
    return (position) => {
      let results = cache.get(position);
      if (!results) {
        const runs = binarizeLine(readLine(position));
        results = runs ? this.#lineDecoder.decodeAll(runs) : [];
        cache.set(position, results);
      }
      return results;
    };
  }
}

/** Convenience wrapper: decodes the first confirmed Code 39 barcode in an RGBA image. */
export function decodeImage(image: RgbaImage, options?: ImageDecodeOptions): DecodedBarcode | null {
  return new Code39ImageDecoder(options).decode(luminanceFromRgba(image));
}
