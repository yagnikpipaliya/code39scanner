import { describe, expect, it, vi } from 'vitest';
import { defineEnum, getOrInsert, isEnumValue } from '@/utils.js';

const Color = defineEnum({ Red: 'red', Blue: 'blue' });

describe('defineEnum', () => {
  it('returns a frozen object with literal values', () => {
    expect(Object.isFrozen(Color)).toBe(true);
    expect(Color.Red).toBe('red');
  });

  it('guards member values', () => {
    expect(isEnumValue(Color, 'red')).toBe(true);
    expect(isEnumValue(Color, 'Red')).toBe(false);
    expect(isEnumValue(Color, 1)).toBe(false);
    expect(isEnumValue(Color, undefined)).toBe(false);
  });
});

describe('getOrInsert', () => {
  it('creates a missing value once, then returns the stored one', () => {
    const map = new Map<string, number[]>();
    const create = vi.fn(() => []);
    getOrInsert(map, 'a', create).push(1);
    getOrInsert(map, 'a', create).push(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(map.get('a')).toEqual([1, 2]);
  });
});
