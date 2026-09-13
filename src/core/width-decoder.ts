import {
  resolveDecodeOptions,
  type DecodeOptions,
  type ResolvedDecodeOptions,
} from '../options.js';
import { BARCODE_FORMAT, type DecodedBarcode } from '../types.js';
import { expandFullAscii } from './full-ascii.js';
import {
  ELEMENTS_PER_CHARACTER,
  PATTERN_TO_CHAR,
  START_STOP_CHARACTER,
  WIDE_ELEMENTS_PER_CHARACTER,
} from './symbology.js';

/**
 * Run-length representation of one scanline.
 *
 * Invariant (produced by `binarizeLine`): runs alternate light/dark, starting and ending with
 * a light run (which may be 0 wide). Even indices are spaces, odd indices are bars.
 */
export type Runs = ArrayLike<number>;

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

interface CharacterMatch {
  readonly char: string;
  /** Total width of the 9 elements. */
  readonly width: number;
  /** Mean narrow-element width — the local module size. */
  readonly narrow: number;
}

/**
 * Classifies the 9 runs at `offset` as one Code 39 character, or `null` if they do not form a
 * well-shaped pattern.
 */
export function matchCharacter(runs: Runs, offset: number): CharacterMatch | null {
  if (offset < 0 || offset + ELEMENTS_PER_CHARACTER > runs.length) return null;

  const widths: number[] = [];
  let total = 0;
  for (let i = 0; i < ELEMENTS_PER_CHARACTER; i++) {
    const width = runs[offset + i]!;
    if (!(width > 0)) return null;
    widths.push(width);
    total += width;
  }

  // Exactly 3 elements are wide: the three widest, which must be clearly separated from the rest.
  const sorted = [...widths].sort((a, b) => b - a);
  const maxWide = sorted[0]!;
  const minWide = sorted[WIDE_ELEMENTS_PER_CHARACTER - 1]!;
  const maxNarrow = sorted[WIDE_ELEMENTS_PER_CHARACTER]!;
  const minNarrow = sorted[ELEMENTS_PER_CHARACTER - 1]!;
  if (minWide < maxNarrow * MIN_WIDE_NARROW_SEPARATION) return null;
  if (maxWide > minWide * MAX_WIDE_SPREAD || maxNarrow > minNarrow * MAX_NARROW_SPREAD) {
    return null;
  }

  let mask = 0;
  let wideSum = 0;
  for (let i = 0; i < ELEMENTS_PER_CHARACTER; i++) {
    const width = widths[i]!;
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

const isWidthConsistent = (current: CharacterMatch, previous: CharacterMatch): boolean =>
  Math.abs(current.width - previous.width) <= previous.width * MAX_CHARACTER_WIDTH_CHANGE;

/**
 * Decodes a Code 39 symbol from the run-lengths of one scanline, in either reading direction.
 */
export class Code39WidthDecoder {
  readonly #options: ResolvedDecodeOptions;

  constructor(options?: DecodeOptions) {
    this.#options = resolveDecodeOptions(options);
  }

  decode(runs: Runs): DecodedBarcode | null {
    // Reversing the runs of an upside-down symbol restores its natural element order.
    return this.#decodeForward(runs) ?? this.#decodeForward(Array.from(runs).reverse());
  }

  #decodeForward(runs: Runs): DecodedBarcode | null {
    for (let start = 1; start + ELEMENTS_PER_CHARACTER < runs.length; start += 2) {
      const result = this.#decodeAt(runs, start);
      if (result) return result;
    }
    return null;
  }

  /** Attempts a full decode assuming the start character begins at bar index `start`. */
  #decodeAt(runs: Runs, start: number): DecodedBarcode | null {
    const { minQuietZone } = this.#options;
    const startChar = matchCharacter(runs, start);
    if (startChar?.char !== START_STOP_CHARACTER) return null;
    if (runs[start - 1]! < minQuietZone * startChar.narrow) return null;

    let raw = '';
    let previous = startChar;
    // `gap` always indexes the light run that follows the previous character.
    for (
      let gap = start + ELEMENTS_PER_CHARACTER;
      gap + ELEMENTS_PER_CHARACTER < runs.length;
      gap += ELEMENTS_PER_CHARACTER + 1
    ) {
      if (runs[gap]! > MAX_GAP_IN_NARROW_WIDTHS * previous.narrow) return null;

      const match = matchCharacter(runs, gap + 1);
      if (!match || !isWidthConsistent(match, previous)) return null;

      if (match.char === START_STOP_CHARACTER) {
        const trailingQuietZone = runs[gap + 1 + ELEMENTS_PER_CHARACTER] ?? 0;
        return trailingQuietZone >= minQuietZone * match.narrow ? this.#finish(raw) : null;
      }
      raw += match.char;
      previous = match;
    }
    return null;
  }

  #finish(raw: string): DecodedBarcode | null {
    if (raw.length < this.#options.minLength) return null;
    const text = this.#options.fullAscii ? expandFullAscii(raw) : raw;
    return text === null ? null : { text, rawText: raw, format: BARCODE_FORMAT };
  }
}
