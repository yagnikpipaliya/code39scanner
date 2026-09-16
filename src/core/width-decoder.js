import { resolveDecodeOptions } from '../options.js';
import { BarcodeFormat } from '../types.js';
import {
  ELEMENTS_PER_CHARACTER,
  expandFullAscii,
  PATTERN_TO_CHAR,
  START_STOP_CHARACTER,
  WIDE_ELEMENTS_PER_CHARACTER,
} from './symbology.js';

/**
 * Run-length representation of one scanline.
 *
 * Invariant (produced by `binarizeLine`): runs alternate light/dark, starting and ending with
 * a light run (which may be 0 wide). Even indices are spaces, odd indices are bars.
 * @typedef {ArrayLike<number>} Runs
 */

/** A symbol found on a scanline. */
/**
 * @typedef {{
 *   readonly barcode: DecodedBarcode;
 *   readonly moduleWidth: number;
 * }} LineSymbol
 */

// Tolerances. The spec allows a wide:narrow ratio of 2.0–3.0; the extra margin absorbs blur,
// print gain and sampling error.
const MIN_WIDE_NARROW_RATIO = 1.6;
const MAX_WIDE_NARROW_RATIO = 4.5;
/** Narrowest wide element must exceed the widest narrow element by this factor. */
const MIN_WIDE_NARROW_SEPARATION = 1.2;
/** Max spread within the wide elements and within the narrow elements of one character. */
const MAX_WIDE_SPREAD = 2;
const MAX_NARROW_SPREAD = 3;
/** Adjacent characters may differ in total width by this fraction (allows perspective). */
const MAX_CHARACTER_WIDTH_CHANGE = 0.25;
/** Upper bound of an inter-character gap, in narrow widths (spec max is ~5.3). */
const MAX_GAP_IN_NARROW_WIDTHS = 6;

const NARROW_ELEMENTS_PER_CHARACTER = ELEMENTS_PER_CHARACTER - WIDE_ELEMENTS_PER_CHARACTER;

/**
 * @typedef {{
 *   readonly char: string;
 *   readonly width: number;
 *   readonly narrow: number;
 * }} CharacterMatch
 */

/**
 * @typedef {LineSymbol & {
 *   readonly end: number;
 * }} SymbolMatch
 */

/**
 * Classifies the 9 runs at `offset` as one Code 39 character, or `null` if they do not form a
 * well-shaped pattern.
 * @param {Runs} runs
 * @param {number} offset
 * @returns {CharacterMatch | null}
 */
export function matchCharacter(runs, offset) {
  if (offset < 0 || offset + ELEMENTS_PER_CHARACTER > runs.length) return null;

  const widths = [];
  let total = 0;
  for (let i = 0; i < ELEMENTS_PER_CHARACTER; i++) {
    const width = runs[offset + i];
    if (!(width > 0)) return null;
    widths.push(width);
    total += width;
  }

  // Exactly 3 elements are wide: the three widest, which must be clearly separated from the rest.
  const sorted = [...widths].sort((a, b) => b - a);
  const maxWide = sorted[0];
  const minWide = sorted[WIDE_ELEMENTS_PER_CHARACTER - 1];
  const maxNarrow = sorted[WIDE_ELEMENTS_PER_CHARACTER];
  const minNarrow = sorted[ELEMENTS_PER_CHARACTER - 1];
  if (minWide < maxNarrow * MIN_WIDE_NARROW_SEPARATION) return null;
  if (maxWide > minWide * MAX_WIDE_SPREAD || maxNarrow > minNarrow * MAX_NARROW_SPREAD) {
    return null;
  }

  let mask = 0;
  let wideSum = 0;
  for (let i = 0; i < ELEMENTS_PER_CHARACTER; i++) {
    const width = widths[i];
    if (width >= minWide) {
      mask |= 1 << (ELEMENTS_PER_CHARACTER - 1 - i);
      wideSum += width;
    }
  }
  const narrow = (total - wideSum) / NARROW_ELEMENTS_PER_CHARACTER;
  const ratio = wideSum / WIDE_ELEMENTS_PER_CHARACTER / narrow;
  if (ratio < MIN_WIDE_NARROW_RATIO || ratio > MAX_WIDE_NARROW_RATIO) return null;

  const char = PATTERN_TO_CHAR.get(mask);
  return char === undefined ? null : { char, width: total, narrow };
}

const isWidthConsistent = (current, previous) =>
  Math.abs(current.width - previous.width) <= previous.width * MAX_CHARACTER_WIDTH_CHANGE;

/** The runs as read left-to-right, then reversed (restores the order of an upside-down symbol). */
function* readingDirections(runs) {
  yield runs;
  yield Array.from(runs).reverse();
}

/**
 * Decodes Code 39 symbols from the run-lengths of one scanline, in both reading directions.
 */
export class Code39WidthDecoder {
  #options;

  constructor(options) {
    this.#options = resolveDecodeOptions(options);
  }

  /** The first symbol on the scanline, or `null`. */
  decode(runs) {
    return this.#collect(runs, true)[0]?.barcode ?? null;
  }

  /** Every distinct symbol on the scanline (e.g. two labels side by side). */
  decodeAll(runs) {
    return this.#collect(runs, false).map((symbol) => symbol.barcode);
  }

  /** Every distinct symbol on the scanline, with its module size. */
  decodeSymbols(runs) {
    return this.#collect(runs, false);
  }

  #collect(runs, stopAtFirst) {
    const found = new Map();
    for (const directed of readingDirections(runs)) {
      for (let start = 1; start + ELEMENTS_PER_CHARACTER < directed.length; start += 2) {
        const match = this.#decodeAt(directed, start);
        if (!match) continue;
        const { barcode, moduleWidth, end } = match;
        if (!found.has(barcode.rawText)) found.set(barcode.rawText, { barcode, moduleWidth });
        if (stopAtFirst) return [...found.values()];
        // Resume at the first bar after this symbol; its quiet zone may lead the next symbol.
        start = end - 1;
      }
    }
    return [...found.values()];
  }

  /** Attempts a full decode assuming the start character begins at bar index `start`. */
  #decodeAt(runs, start) {
    const { minQuietZone } = this.#options;
    const startChar = matchCharacter(runs, start);
    if (startChar?.char !== START_STOP_CHARACTER) return null;
    if (runs[start - 1] < minQuietZone * startChar.narrow) return null;

    let raw = '';
    let previous = startChar;
    let narrowSum = startChar.narrow;
    let characters = 1;
    // `gap` always indexes the light run that follows the previous character.
    // Allow variable inter-character gaps by searching for the next character
    // within a reasonable range after the previous character.
    let gap = start + ELEMENTS_PER_CHARACTER;
    while (gap + ELEMENTS_PER_CHARACTER < runs.length) {
      // Check if the gap is too large (exceeds max allowed gap in narrow widths)
      if (runs[gap] > MAX_GAP_IN_NARROW_WIDTHS * previous.narrow) return null;

      // Try to match a character at the next position (gap + 1)
      // But also try subsequent positions in case the gap is wider than 1
      let matched = false;
      for (let tryOffset = 1; tryOffset <= 3; tryOffset++) {
        const matchPos = gap + tryOffset;
        if (matchPos + ELEMENTS_PER_CHARACTER >= runs.length) break;

        const match = matchCharacter(runs, matchPos);
        if (match && isWidthConsistent(match, previous)) {
          // Found a valid character
          narrowSum += match.narrow;
          characters++;
          gap = matchPos + ELEMENTS_PER_CHARACTER; // Update gap to after this character

          if (match.char === START_STOP_CHARACTER) {
            const end = gap;
            if ((runs[end] ?? 0) < minQuietZone * match.narrow) return null;
            const barcode = this.#finish(raw);
            return barcode && { barcode, end, moduleWidth: narrowSum / characters };
          }
          raw += match.char;
          previous = match;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // No valid character found at any reasonable offset
        return null;
      }
    }
    return null;
  }

  #finish(raw) {
    if (raw.length < this.#options.minLength) return null;
    // A payload that is not valid Full ASCII as a whole is, by definition, plain Code 39.
    const text = this.#options.fullAscii ? (expandFullAscii(raw) ?? raw) : raw;
    return { text, rawText: raw, format: BarcodeFormat.Code39 };
  }
}