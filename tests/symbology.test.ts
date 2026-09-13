import { describe, expect, it } from 'vitest';
import {
  CHAR_TO_PATTERN,
  CODE39_ALPHABET,
  ELEMENTS_PER_CHARACTER,
  isWideElement,
  PATTERN_TO_CHAR,
  WIDE_ELEMENTS_PER_CHARACTER,
} from '../src/core/symbology.js';

const wideCount = (mask: number) =>
  Array.from({ length: ELEMENTS_PER_CHARACTER }, (_, i) => isWideElement(mask, i)).filter(Boolean)
    .length;

describe('symbology', () => {
  it('defines all 43 data characters plus the start/stop character', () => {
    expect(CODE39_ALPHABET).toHaveLength(44);
    expect(CHAR_TO_PATTERN.size).toBe(44);
  });

  it('has unique patterns', () => {
    expect(PATTERN_TO_CHAR.size).toBe(CHAR_TO_PATTERN.size);
  });

  it('gives every pattern exactly 3 wide elements', () => {
    for (const mask of CHAR_TO_PATTERN.values()) {
      expect(wideCount(mask)).toBe(WIDE_ELEMENTS_PER_CHARACTER);
    }
  });

  it('matches the spec for "*": n W n n W n W n n (bar,space,…)', () => {
    const mask = CHAR_TO_PATTERN.get('*')!;
    const pattern = Array.from({ length: 9 }, (_, i) => (isWideElement(mask, i) ? 'W' : 'n'));
    expect(pattern.join('')).toBe('nWnnWnWnn');
  });

  it('encodes $ / + % with three wide spaces and no wide bars', () => {
    for (const char of '$/+%') {
      const mask = CHAR_TO_PATTERN.get(char)!;
      const wideBars = [0, 2, 4, 6, 8].filter((i) => isWideElement(mask, i));
      expect(wideBars).toEqual([]);
    }
  });
});
