import {
  resolveDecodeOptions,
  type DecodeOptions,
  type ResolvedDecodeOptions,
} from '../options.js';
import { BarcodeFormat, type DecodedBarcode } from '../types.js';
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

/** A symbol found on a scanline, with its extent along the line (in run units, i.e. pixels). */
export interface LineSymbol {
  readonly barcode: DecodedBarcode;
  /** Distance from the start of the line to the symbol's first bar. */
  readonly offset: number;
  /** Extent from the first bar of the start character to the last bar of the stop character. */
  readonly length: number;
}

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

interface SymbolMatch {
  readonly barcode: DecodedBarcode;
  /** Index of the symbol's trailing quiet zone (which may lead into the next symbol). */
  readonly end: number;
}

interface ReadingDirection {
  readonly runs: Runs;
  readonly reversed: boolean;
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

function sumRuns(runs: Runs, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += runs[i]!;
  return sum;
}

/** The runs as read left-to-right, then reversed (restores the order of an upside-down symbol). */
function* readingDirections(runs: Runs): Generator<ReadingDirection> {
  yield { runs, reversed: false };
  yield { runs: Array.from(runs).reverse(), reversed: true };
}

/** Locates a match on the original (unreversed) line. */
function toLineSymbol(
  { runs, reversed }: ReadingDirection,
  start: number,
  { barcode, end }: SymbolMatch,
): LineSymbol {
  const length = sumRuns(runs, start, end);
  const offset = reversed ? sumRuns(runs, end, runs.length) : sumRuns(runs, 0, start);
  return { barcode, offset, length };
}

/**
 * Decodes Code 39 symbols from the run-lengths of one scanline, in both reading directions.
 */
export class Code39WidthDecoder {
  readonly #options: ResolvedDecodeOptions;

  constructor(options?: DecodeOptions) {
    this.#options = resolveDecodeOptions(options);
  }

  /** The first symbol on the scanline, or `null`. */
  decode(runs: Runs): DecodedBarcode | null {
    return this.#collect(runs, true)[0]?.barcode ?? null;
  }

  /** Every distinct symbol on the scanline (e.g. two labels side by side). */
  decodeAll(runs: Runs): DecodedBarcode[] {
    return this.#collect(runs, false).map((symbol) => symbol.barcode);
  }

  /** Every distinct symbol on the scanline, with its position along the line. */
  decodeSymbols(runs: Runs): LineSymbol[] {
    return this.#collect(runs, false);
  }

  #collect(runs: Runs, stopAtFirst: boolean): LineSymbol[] {
    const found = new Map<string, LineSymbol>();
    for (const direction of readingDirections(runs)) {
      const directed = direction.runs;
      for (let start = 1; start + ELEMENTS_PER_CHARACTER < directed.length; start += 2) {
        const match = this.#decodeAt(directed, start);
        if (!match) continue;
        if (!found.has(match.barcode.rawText)) {
          found.set(match.barcode.rawText, toLineSymbol(direction, start, match));
        }
        if (stopAtFirst) return [...found.values()];
        // Resume at the first bar after this symbol; its quiet zone may lead the next symbol.
        start = match.end - 1;
      }
    }
    return [...found.values()];
  }

  /** Attempts a full decode assuming the start character begins at bar index `start`. */
  #decodeAt(runs: Runs, start: number): SymbolMatch | null {
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
        const end = gap + 1 + ELEMENTS_PER_CHARACTER;
        if ((runs[end] ?? 0) < minQuietZone * match.narrow) return null;
        const barcode = this.#finish(raw);
        return barcode && { barcode, end };
      }
      raw += match.char;
      previous = match;
    }
    return null;
  }

  #finish(raw: string): DecodedBarcode | null {
    if (raw.length < this.#options.minLength) return null;
    // A payload that is not valid Full ASCII as a whole is, by definition, plain Code 39.
    const text = this.#options.fullAscii ? (expandFullAscii(raw) ?? raw) : raw;
    return { text, rawText: raw, format: BarcodeFormat.Code39 };
  }
}
