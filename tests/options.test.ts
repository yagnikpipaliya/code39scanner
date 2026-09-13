import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '../src/errors.js';
import {
  DEFAULT_SCANNER_OPTIONS,
  resolveScannerOptions,
  validateNumberOption,
} from '../src/options.js';
import { ScanOrientation } from '../src/types.js';

describe('resolveScannerOptions', () => {
  it('returns frozen defaults', () => {
    const options = resolveScannerOptions();
    expect(options).toEqual(DEFAULT_SCANNER_OPTIONS);
    expect(Object.isFrozen(options)).toBe(true);
  });

  it('merges overrides, keeps defaults for undefined and de-duplicates orientations', () => {
    const options = resolveScannerOptions({
      scanIntervalMs: 250,
      orientations: [ScanOrientation.Vertical, ScanOrientation.Vertical],
      minLength: undefined,
    } as never);
    expect(options.scanIntervalMs).toBe(250);
    expect(options.minLength).toBe(DEFAULT_SCANNER_OPTIONS.minLength);
    expect(options.orientations).toEqual([ScanOrientation.Vertical]);
  });

  it('accepts more confirmations than primary scanlines (the bar walk supplies them)', () => {
    expect(resolveScannerOptions({ scanLines: 2, minConfirmations: 5 }).minConfirmations).toBe(5);
  });

  it.each([
    { scanIntervalMs: -1 },
    { scanIntervalMs: Number.NaN },
    { presenceTimeoutMs: Infinity },
    { maxFrameSize: 10 },
    { maxFrameSize: 640.5 },
    { minLength: 1.5 },
    { minFrameConfirmations: 0 },
    { minFrameConfirmations: 2.5 },
  ])('rejects %j', (options) => {
    expect(() => resolveScannerOptions(options)).toThrow(InvalidOptionsError);
  });
});

describe('validateNumberOption', () => {
  it('returns valid values', () => {
    expect(validateNumberOption('linePhase', 0.25)).toBe(0.25);
    expect(validateNumberOption('maxFrameSize', 1280)).toBe(1280);
  });

  it('rejects non-numbers, out-of-range and non-integer values with the allowed range', () => {
    expect(() => validateNumberOption('linePhase', '0.5')).toThrow(InvalidOptionsError);
    expect(() => validateNumberOption('linePhase', 1.01)).toThrow('between 0 and 1');
    expect(() => validateNumberOption('scanLines', 2.5)).toThrow('an integer');
  });
});
