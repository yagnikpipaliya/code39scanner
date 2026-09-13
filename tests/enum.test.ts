import { describe, expect, it } from 'vitest';
import { defineEnum, isEnumValue } from '../src/utils/enum.js';

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
