import { describe, expect, it } from 'vitest';
import { Code39ImageDecoder } from '../src/image/image-decoder.js';
import { grayLuminance, rgbaLuminance, toGrayscale } from '../src/image/luminance.js';
import type { GrayImage } from '../src/types.js';
import { renderBarcode, renderNoise } from './helpers/encode.js';

describe('luminance sources', () => {
  const rgba = renderNoise(37, 23, 3);
  const gray = toGrayscale(rgba);

  it('converts RGBA rows and columns exactly like a full grayscale conversion', () => {
    const fromRgba = rgbaLuminance(rgba);
    const fromGray = grayLuminance(gray);
    for (const y of [0, 11, 22]) expect(fromRgba.row(y)).toEqual(fromGray.row(y));
    for (const x of [0, 18, 36]) expect(fromRgba.column(x)).toEqual(fromGray.column(x));
  });

  it('uses Rec. 601 weights', () => {
    const pixel = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) };
    expect(toGrayscale(pixel).data[0]).toBe(76);
  });

  it('rejects inconsistent gray images', () => {
    const invalid: GrayImage = { width: 4, height: 4, data: new Uint8Array(8) };
    expect(() => grayLuminance(invalid)).toThrow(TypeError);
  });

  it('decodes grayscale input directly', () => {
    const decoder = new Code39ImageDecoder();
    const image = toGrayscale(renderBarcode('GRAY', { narrow: 2 }));
    expect(decoder.decodeGray(image)?.text).toBe('GRAY');
    expect(decoder.decodeAllGray(image).map((r) => r.text)).toEqual(['GRAY']);
  });
});
