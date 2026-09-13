import { describe, expect, it } from 'vitest';
import { CODE39_ALPHABET } from '../src/core/symbology.js';
import { Code39WidthDecoder, matchCharacter } from '../src/core/width-decoder.js';
import { InvalidOptionsError } from '../src/errors.js';
import { BarcodeFormat } from '../src/types.js';
import { encodeRuns, joinRuns, toFullAscii } from './helpers/encode.js';

const decoder = new Code39WidthDecoder();
const DATA_CHARS = CODE39_ALPHABET.replace('*', '');

describe('Code39WidthDecoder', () => {
  it('decodes every data character', () => {
    const result = decoder.decode(encodeRuns(DATA_CHARS));
    expect(result).toEqual({ text: DATA_CHARS, rawText: DATA_CHARS, format: BarcodeFormat.Code39 });
  });

  it.each([2, 2.5, 3])('decodes with wide:narrow ratio %s', (ratio) => {
    expect(decoder.decode(encodeRuns('RATIO-42', { ratio }))?.text).toBe('RATIO-42');
  });

  it.each([0.7, 1, 3.3, 11])('decodes at narrow width %s', (narrow) => {
    expect(decoder.decode(encodeRuns('SCALE', { narrow }))?.text).toBe('SCALE');
  });

  it('decodes a reversed (upside-down) symbol', () => {
    expect(decoder.decode(encodeRuns('REVERSE 9').reverse())?.text).toBe('REVERSE 9');
  });

  it('decodes when the symbol is surrounded by other runs', () => {
    const runs = [3, 1, 2, 1, ...encodeRuns('EMBED', { quietZone: 12 }), 2, 1, 1];
    // Keep the light/dark alternation valid: the prefix ends dark, the symbol starts light.
    expect(decoder.decode(runs)?.text).toBe('EMBED');
  });

  it('tolerates moderate width jitter', () => {
    const runs = encodeRuns('JITTER', { narrow: 4 }).map((w, i) => w + (i % 3 === 0 ? 0.6 : -0.4));
    expect(decoder.decode(runs)?.text).toBe('JITTER');
  });

  it('tolerates gradual width change (perspective)', () => {
    const runs = encodeRuns('PERSPECTIVE', { narrow: 3 }).map((w, i) => w * (1 + i * 0.004));
    expect(decoder.decode(runs)?.text).toBe('PERSPECTIVE');
  });

  it('rejects a symbol without a stop character', () => {
    const runs = encodeRuns('*NOSTOP', { raw: true });
    expect(decoder.decode(runs)).toBeNull();
  });

  it('rejects a symbol without a start character', () => {
    expect(decoder.decode(encodeRuns('NOSTART*', { raw: true }))).toBeNull();
  });

  it('rejects insufficient quiet zones', () => {
    expect(decoder.decode(encodeRuns('QZ', { quietZone: 2 }))).toBeNull();
    expect(
      new Code39WidthDecoder({ minQuietZone: 1 }).decode(encodeRuns('QZ', { quietZone: 2 })),
    ).not.toBeNull();
  });

  it('rejects an oversized inter-character gap', () => {
    expect(decoder.decode(encodeRuns('GAP', { gap: 8 }))).toBeNull();
  });

  it('rejects an abrupt character width change', () => {
    const runs = encodeRuns('AB');
    const scaled = runs.map((w, i) => (i >= 21 ? w * 1.6 : w));
    expect(decoder.decode(scaled)).toBeNull();
  });

  it('enforces minLength', () => {
    const strict = new Code39WidthDecoder({ minLength: 4 });
    expect(strict.decode(encodeRuns('ABC'))).toBeNull();
    expect(strict.decode(encodeRuns('ABCD'))?.text).toBe('ABCD');
  });

  it('expands Full ASCII only when enabled', () => {
    const runs = encodeRuns(toFullAscii('Hello, World!'));
    expect(decoder.decode(runs)?.text).toBe('H+E+L+L+O/L W+O+R+L+D/A');
    const full = new Code39WidthDecoder({ fullAscii: true }).decode(runs);
    expect(full).toEqual({
      text: 'Hello, World!',
      rawText: 'H+E+L+L+O/L W+O+R+L+D/A',
      format: BarcodeFormat.Code39,
    });
  });

  it('returns plain Code 39 when a Full ASCII payload is invalid (e.g. "12/34-A")', () => {
    const result = new Code39WidthDecoder({ fullAscii: true }).decode(encodeRuns('12/34-A'));
    expect(result).toEqual({ text: '12/34-A', rawText: '12/34-A', format: BarcodeFormat.Code39 });
  });

  it('returns null for empty or garbage input', () => {
    expect(decoder.decode([])).toBeNull();
    expect(decoder.decode([5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 5])).toBeNull();
  });

  it('validates options', () => {
    expect(() => new Code39WidthDecoder({ minLength: 0 })).toThrow(InvalidOptionsError);
    expect(() => new Code39WidthDecoder({ minQuietZone: -1 })).toThrow(InvalidOptionsError);
    expect(() => new Code39WidthDecoder({ fullAscii: 'yes' as unknown as boolean })).toThrow(
      InvalidOptionsError,
    );
  });
});

describe('Code39WidthDecoder.decodeAll', () => {
  const texts = (runs: number[]) => decoder.decodeAll(runs).map((result) => result.text);

  it('finds every symbol on one scanline, while decode() returns the first', () => {
    const runs = joinRuns(encodeRuns('LEFT'), encodeRuns('RIGHT'));
    expect(texts(runs)).toEqual(['LEFT', 'RIGHT']);
    expect(decoder.decode(runs)?.text).toBe('LEFT');
  });

  it('finds symbols printed in opposite directions', () => {
    expect(texts(joinRuns(encodeRuns('UP'), encodeRuns('DOWN').reverse()))).toEqual(['UP', 'DOWN']);
  });

  it('reports a repeated symbol once', () => {
    expect(texts(joinRuns(encodeRuns('SAME'), encodeRuns('SAME')))).toEqual(['SAME']);
  });

  it('reports the module width of each symbol', () => {
    const runs = joinRuns(encodeRuns('WIDE', { narrow: 4 }), encodeRuns('THIN', { narrow: 2 }));
    const symbols = decoder.decodeSymbols(runs);
    expect(symbols.map(({ barcode, moduleWidth }) => [barcode.text, moduleWidth])).toEqual([
      ['WIDE', 4],
      ['THIN', 2],
    ]);
  });

  it('returns an empty list when nothing decodes', () => {
    expect(decoder.decodeAll([10, 1, 10])).toEqual([]);
  });
});

describe('matchCharacter', () => {
  it('rejects zero-width and out-of-range elements', () => {
    expect(matchCharacter([1, 0, 1, 1, 1, 1, 1, 1, 1], 0)).toBeNull();
    expect(matchCharacter([1, 1, 1], 0)).toBeNull();
    expect(matchCharacter([1, 1, 1, 1, 1, 1, 1, 1, 1], -1)).toBeNull();
  });

  it('rejects ambiguous wide/narrow separation', () => {
    // Four equally wide elements: no clear set of three.
    expect(matchCharacter([2.5, 2.5, 2.5, 2.5, 1, 1, 1, 1, 1], 0)).toBeNull();
  });

  it('rejects ratios outside the tolerated range', () => {
    // '*' pattern with ratio 6.
    expect(matchCharacter([1, 6, 1, 1, 6, 1, 6, 1, 1], 0)).toBeNull();
  });

  it('rejects uneven wide or narrow elements', () => {
    expect(matchCharacter([1, 2.5, 1, 1, 5.5, 1, 2.5, 1, 1], 0)).toBeNull();
    expect(matchCharacter([0.3, 2.5, 1, 1, 2.5, 1, 2.5, 1, 1], 0)).toBeNull();
  });

  it('rejects well-shaped patterns that are not Code 39 characters', () => {
    // Three wide bars: valid characters have 2 wide bars + 1 wide space, or 3 wide spaces.
    expect(matchCharacter([2.5, 1, 2.5, 1, 2.5, 1, 1, 1, 1], 0)).toBeNull();
  });
});
