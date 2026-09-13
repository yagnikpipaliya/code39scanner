/**
 * Code 39 symbology definition — the single source of truth for character patterns.
 *
 * Every character is 9 elements (5 bars, 4 spaces, starting and ending with a bar),
 * exactly 3 of which are wide. A pattern is stored as a 9-bit mask where the most
 * significant bit is the first element and a set bit means "wide".
 */

export const ELEMENTS_PER_CHARACTER = 9;
export const WIDE_ELEMENTS_PER_CHARACTER = 3;
export const START_STOP_CHARACTER = '*';

/** All data characters of standard Code 39, in check-value order, followed by the start/stop. */
export const CODE39_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';

// prettier-ignore
const PATTERN_MASKS: readonly number[] = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, // 0-9
  0x109, 0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c, // A-J
  0x103, 0x043, 0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016, // K-T
  0x181, 0x0c1, 0x1c0, 0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4,        // U-Z - . space
  0x0a8, 0x0a2, 0x08a, 0x02a,                                           // $ / + %
  0x094,                                                                // *
];

const entries = [...CODE39_ALPHABET].map((char, index) => [char, PATTERN_MASKS[index]!] as const);

/** Character → 9-bit wide/narrow mask. */
export const CHAR_TO_PATTERN: ReadonlyMap<string, number> = new Map(entries);

/** 9-bit wide/narrow mask → character. */
export const PATTERN_TO_CHAR: ReadonlyMap<number, string> = new Map(
  entries.map(([char, mask]) => [mask, char]),
);

/** Whether element `index` (0 = first bar) of `mask` is wide. */
export function isWideElement(mask: number, index: number): boolean {
  return ((mask >> (ELEMENTS_PER_CHARACTER - 1 - index)) & 1) === 1;
}
