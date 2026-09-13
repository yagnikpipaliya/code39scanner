import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '../src/errors.js';
import { DEFAULT_SCANNER_OPTIONS, resolveScannerOptions } from '../src/options.js';

describe('resolveScannerOptions', () => {
  it('returns frozen defaults', () => {
    const options = resolveScannerOptions();
    expect(options).toEqual(DEFAULT_SCANNER_OPTIONS);
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('merges overrides and de-duplicates orientations', () => {
    const options = resolveScannerOptions({
      scanIntervalMs: 250,
      orientations: ['vertical', 'vertical'],
    });
    expect(options.scanIntervalMs).toBe(250);
    expect(options.orientations).toEqual(['vertical']);
  });

  it.each([
    { scanIntervalMs: -1 },
    { scanIntervalMs: Number.NaN },
    { presenceTimeoutMs: Infinity },
    { maxFrameSize: 10 },
    { maxFrameSize: 640.5 },
    { minLength: 1.5 },
  ])('rejects %j', (options) => {
    expect(() => resolveScannerOptions(options)).toThrow(InvalidOptionsError);
  });
});
