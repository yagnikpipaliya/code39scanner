import { Code39WidthDecoder } from '../core/width-decoder.js';
import {
  resolveImageDecodeOptions,
  type ImageDecodeOptions,
  type ResolvedImageDecodeOptions,
} from '../options.js';
import type { DecodedBarcode, GrayImage, RgbaImage, ScanOrientation } from '../types.js';
import { grayLuminance, rgbaLuminance, type LuminanceSource } from './luminance.js';
import { binarizeLine } from './scanline-binarizer.js';

/** Evenly spaced line positions across `length`, ordered from the center outwards. */
function centerOutPositions(count: number, length: number): number[] {
  const lines = Math.min(count, length);
  const center = (length - 1) / 2;
  return Array.from({ length: lines }, (_, k) => Math.floor(((k + 0.5) * length) / lines)).sort(
    (a, b) => Math.abs(a - center) - Math.abs(b - center),
  );
}

function* scanlines(
  source: LuminanceSource,
  orientation: ScanOrientation,
  count: number,
): Generator<Uint8Array> {
  if (orientation === 'horizontal') {
    for (const y of centerOutPositions(count, source.height)) yield source.row(y);
  } else {
    for (const x of centerOutPositions(count, source.width)) yield source.column(x);
  }
}

/**
 * Finds Code 39 barcodes in an image by sampling scanlines in one or both orientations.
 * A value is reported only after `minConfirmations` independent scanlines agree on it,
 * which suppresses false positives from noise.
 */
export class Code39ImageDecoder {
  readonly #options: ResolvedImageDecodeOptions;
  readonly #lineDecoder: Code39WidthDecoder;

  constructor(options?: ImageDecodeOptions) {
    this.#options = resolveImageDecodeOptions(options);
    this.#lineDecoder = new Code39WidthDecoder(this.#options);
  }

  /** First confirmed barcode in an RGBA image (e.g. `ImageData`), or `null`. */
  decode(image: RgbaImage): DecodedBarcode | null {
    return this.#scan(rgbaLuminance(image), true)[0] ?? null;
  }

  /** All distinct confirmed barcodes in an RGBA image. */
  decodeAll(image: RgbaImage): DecodedBarcode[] {
    return this.#scan(rgbaLuminance(image), false);
  }

  /** First confirmed barcode in a single-channel luminance image, or `null`. */
  decodeGray(image: GrayImage): DecodedBarcode | null {
    return this.#scan(grayLuminance(image), true)[0] ?? null;
  }

  /** All distinct confirmed barcodes in a single-channel luminance image. */
  decodeAllGray(image: GrayImage): DecodedBarcode[] {
    return this.#scan(grayLuminance(image), false);
  }

  #scan(source: LuminanceSource, stopAtFirst: boolean): DecodedBarcode[] {
    const { orientations, scanLines, minConfirmations } = this.#options;
    const votes = new Map<string, number>();
    const confirmed: DecodedBarcode[] = [];

    for (const orientation of orientations) {
      for (const line of scanlines(source, orientation, scanLines)) {
        const runs = binarizeLine(line);
        const result = runs && this.#lineDecoder.decode(runs);
        if (!result) continue;

        const count = (votes.get(result.rawText) ?? 0) + 1;
        votes.set(result.rawText, count);
        if (count === minConfirmations) {
          confirmed.push(result);
          if (stopAtFirst) return confirmed;
        }
      }
    }
    return confirmed;
  }
}

/** Convenience wrapper: decodes the first confirmed Code 39 barcode in an RGBA image. */
export function decodeImage(image: RgbaImage, options?: ImageDecodeOptions): DecodedBarcode | null {
  return new Code39ImageDecoder(options).decode(image);
}
