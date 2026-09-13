import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../src/errors.js';
import { Code39ImageDecoder } from '../src/image/image-decoder.js';
import {
  luminanceFromGray,
  luminanceFromRgba,
  lumaLine,
  toGrayscale,
} from '../src/image/luminance.js';
import type { GrayImage } from '../src/types.js';
import { renderBarcode, renderNoise } from './helpers/encode.js';

describe('luminance sources', () => {
  const rgba = renderNoise(37, 23, 3);
  const gray = toGrayscale(rgba);

  it('converts RGBA rows and columns exactly like a full grayscale conversion', () => {
    const fromRgba = luminanceFromRgba(rgba);
    const fromGray = luminanceFromGray(gray);
    for (const y of [0, 11, 22]) expect(fromRgba.row(y)).toEqual(fromGray.row(y));
    for (const x of [0, 18, 36]) expect(fromRgba.column(x)).toEqual(fromGray.column(x));
  });

  it('uses Rec. 601 weights', () => {
    expect(lumaLine([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 3)).toEqual(
      new Uint8Array([76, 149, 28]),
    );
  });

  it('rejects inconsistent gray images', () => {
    const invalid: GrayImage = { width: 4, height: 4, data: new Uint8Array(8) };
    expect(() => luminanceFromGray(invalid)).toThrow(InvalidArgumentError);
  });

  it('decodes grayscale input', () => {
    const decoder = new Code39ImageDecoder();
    const source = luminanceFromGray(toGrayscale(renderBarcode('GRAY', { narrow: 2 })));
    expect(decoder.decode(source)?.text).toBe('GRAY');
    expect(decoder.decodeAll(source).map((r) => r.text)).toEqual(['GRAY']);
  });
});
