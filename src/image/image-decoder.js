import { Code39WidthDecoder } from '../core/width-decoder.js';
import { resolveImageDecodeOptions, validateNumberOption } from '../options.js';
import { ScanOrientation } from '../types.js';
import { getOrInsert } from '../utils.js';
import { toLuminanceSource } from './luminance.js';
import { binarizeLine } from './scanline-binarizer.js';

/**
 * @typedef {import('../types.js').DecodedBarcode} DecodedBarcode
 * @typedef {import('../types.js').ImageInput} ImageInput
 * @typedef {import('../types.js').LuminanceSource} LuminanceSource
 * @typedef {import('../options.js').ImageDecodeOptions} ImageDecodeOptions
 * @typedef {import('../options.js').ScanPassOptions} ScanPassOptions
 * @typedef {import('../core/width-decoder.js').LineSymbol} LineSymbol
 */

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

/**
 * Scanlines whose measured module widths differ by at most this fraction belong to the same
 * symbol size. Measurements of one barcode vary with tilt, perspective and blur; labels of the
 * same text but clearly different sizes stay apart.
 */
const MODULE_WIDTH_TOLERANCE = 0.25;

/**
 * Evenly spaced primary line positions across `length`, ordered from the center outwards.
 * @param {number} count
 * @param {number} length
 * @param {number} phase
 * @returns {number[]}
 */
function primaryLinePositions(count, length, phase) {
  const lines = Math.min(count, length);
  const center = (length - 1) / 2;
  return Array.from({ length: lines }, (_, k) =>
    Math.min(length - 1, Math.floor(((k + phase) * length) / lines)),
  ).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
}

/**
 * Positions `step` apart, walking from `position` (exclusive) towards one image edge.
 * @param {number} position
 * @param {number} step
 * @param {number} length
 * @returns {Generator<number>}
 */
function* walkFrom(position, step, length) {
  for (let next = position + step; next >= 0 && next < length; next += step) yield next;
}

/**
 * Size of the largest subset of sorted `positions` whose members are `spacing` or more apart.
 * @param {readonly number[]} positions
 * @param {number} spacing
 * @returns {number}
 */
function countIndependent(positions, spacing) {
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

/** Scanlines supporting one value at one symbol size. */
class SupportGroup {
  /** @type {number} */
  moduleWidth;
  /**
   * Minimum distance between two independent supporting lines.
   * @type {number}
   */
  spacing;
  /** @type {Map<string, Set<number>>} */
  #lines = new Map();

  /** @param {number} moduleWidth */
  constructor(moduleWidth) {
    this.moduleWidth = moduleWidth;
    this.spacing = Math.max(1, Math.round(moduleWidth * MIN_CONFIRMATION_SPACING_MODULES));
  }

  /**
   * @param {number} moduleWidth
   * @returns {boolean}
   */
  matches(moduleWidth) {
    return Math.abs(moduleWidth - this.moduleWidth) <= this.moduleWidth * MODULE_WIDTH_TOLERANCE;
  }

  /**
   * Records a supporting line; returns the number of mutually independent supporting lines.
   * @param {string} orientation
   * @param {number} position
   * @returns {number}
   */
  add(orientation, position) {
    getOrInsert(this.#lines, orientation, () => new Set()).add(position);

    let independent = 0;
    for (const linePositions of this.#lines.values()) {
      independent += countIndependent(
        [...linePositions].sort((a, b) => a - b),
        this.spacing,
      );
    }
    return independent;
  }
}

/** Groups supporting scanlines by value and symbol size (see {@link MODULE_WIDTH_TOLERANCE}). */
class ConfirmationLedger {
  /** @type {Map<string, SupportGroup[]>} */
  #groups = new Map();

  /**
   * @param {string} rawText
   * @param {number} moduleWidth
   * @returns {SupportGroup}
   */
  groupFor(rawText, moduleWidth) {
    const groups = getOrInsert(this.#groups, rawText, () => []);
    let group = groups.find((candidate) => candidate.matches(moduleWidth));
    if (!group) {
      group = new SupportGroup(moduleWidth);
      groups.push(group);
    }
    return group;
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
  /** @type {import('../options.js').ResolvedImageDecodeOptions} */
  #options;
  /** @type {Code39WidthDecoder} */
  #lineDecoder;

  /** @param {ImageDecodeOptions} [options] */
  constructor(options) {
    this.#options = resolveImageDecodeOptions(options);
    this.#lineDecoder = new Code39WidthDecoder(this.#options);
  }

  /**
   * The first confirmed barcode, or `null`.
   * @param {ImageInput} input
   * @param {ScanPassOptions} [pass]
   * @returns {DecodedBarcode | null}
   */
  decode(input, pass) {
    return this.#scan(toLuminanceSource(input), pass, true)[0] ?? null;
  }

  /**
   * All distinct confirmed barcodes.
   * @param {ImageInput} input
   * @param {ScanPassOptions} [pass]
   * @returns {DecodedBarcode[]}
   */
  decodeAll(input, pass) {
    return this.#scan(toLuminanceSource(input), pass, false);
  }

  /**
   * @param {LuminanceSource} source
   * @param {ScanPassOptions | undefined} pass
   * @param {boolean} stopAtFirst
   * @returns {DecodedBarcode[]}
   */
  #scan(source, pass = {}, stopAtFirst) {
    const phase = validateNumberOption('linePhase', pass.linePhase ?? DEFAULT_LINE_PHASE);
    if (source.width === 0 || source.height === 0) return [];

    const { orientations, scanLines, minConfirmations } = this.#options;
    const ledger = new ConfirmationLedger();
    /** @type {Map<string, DecodedBarcode>} */
    const confirmed = new Map();

    for (const orientation of orientations) {
      const horizontal = orientation === ScanOrientation.Horizontal;
      const length = horizontal ? source.height : source.width;
      const decodeLine = this.#cachedLineDecoder((position) =>
        horizontal ? source.row(position) : source.column(position),
      );
      /**
       * @param {number} position
       * @param {string} rawText
       */
      const decodes = (position, rawText) =>
        decodeLine(position).some((symbol) => symbol.barcode.rawText === rawText);

      for (const position of primaryLinePositions(scanLines, length, phase)) {
        for (const { barcode, moduleWidth } of decodeLine(position)) {
          const { rawText } = barcode;
          if (confirmed.has(rawText)) continue;

          const group = ledger.groupFor(rawText, moduleWidth);
          let support = group.add(orientation, position);
          // Walk along the bars in both directions until the value stops decoding.
          for (const step of [-group.spacing, group.spacing]) {
            for (const probe of walkFrom(position, step, length)) {
              if (support >= minConfirmations || !decodes(probe, rawText)) break;
              support = group.add(orientation, probe);
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

  /**
   * Decodes lines of one orientation, each position at most once.
   * @param {(position: number) => Uint8Array} readLine
   * @returns {(position: number) => LineSymbol[]}
   */
  #cachedLineDecoder(readLine) {
    /** @type {Map<number, LineSymbol[]>} */
    const cache = new Map();
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
 * @param {ImageInput} input
 * @param {ImageDecodeOptions} [options]
 * @returns {DecodedBarcode | null}
 */
export function decodeImage(input, options) {
  return new Code39ImageDecoder(options).decode(input);
}
