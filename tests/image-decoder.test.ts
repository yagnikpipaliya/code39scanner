import { describe, expect, it } from 'vitest';
import { InvalidArgumentError, InvalidOptionsError } from '../src/errors.js';
import { Code39ImageDecoder, decodeImage } from '../src/image/image-decoder.js';
import { luminanceFromRgba, toGrayscale } from '../src/image/luminance.js';
import { binarizeLine } from '../src/image/scanline-binarizer.js';
import { ScanOrientation, type RgbaImage } from '../src/types.js';
import {
  composeImages,
  renderBarcode,
  renderNoise,
  rotate180,
  rotate90,
  toFullAscii,
} from './helpers/encode.js';

const TEXT = 'CODE39-TEST';
const HORIZONTAL_ONLY = { orientations: [ScanOrientation.Horizontal] } as const;

describe('decodeImage', () => {
  // ~1.5 px per narrow element is the documented minimum: below it, a narrow space between two
  // bars no longer reaches light level in any pixel (sampling limit), so edges cannot be resolved.
  it.each([1.5, 2, 3, 4, 8])('decodes at %spx narrow width', (narrow) => {
    expect(decodeImage(renderBarcode(TEXT, { narrow }))?.text).toBe(TEXT);
  });

  it.each([2, 2.5, 3])('decodes with ratio %s', (ratio) => {
    expect(decodeImage(renderBarcode(TEXT, { narrow: 2, ratio }))?.text).toBe(TEXT);
  });

  it('decodes a noisy, blurred, low-contrast image', () => {
    const image = renderBarcode(TEXT, {
      narrow: 3,
      light: 170,
      dark: 90,
      noise: 12,
      blur: 2,
      seed: 42,
    });
    expect(decodeImage(image)?.text).toBe(TEXT);
  });

  it('decodes under strongly uneven illumination', () => {
    const image = renderBarcode(TEXT, { narrow: 3, gradient: 0.7, margin: 40 });
    expect(decodeImage(image)?.text).toBe(TEXT);
  });

  it('decodes a barcode inside a large margin', () => {
    const image = renderBarcode('M', { narrow: 3, margin: 300, height: 200, barHeight: 0.3 });
    expect(decodeImage(image)?.text).toBe('M');
  });

  it('decodes upside-down (180°)', () => {
    expect(decodeImage(rotate180(renderBarcode(TEXT, { narrow: 2 })))?.text).toBe(TEXT);
  });

  it('decodes vertical barcodes (90°)', () => {
    const image = rotate90(renderBarcode(TEXT, { narrow: 2 }));
    expect(decodeImage(image)?.text).toBe(TEXT);
    expect(decodeImage(image, HORIZONTAL_ONLY)).toBeNull();
  });

  it('decodes Full ASCII when enabled', () => {
    const image = renderBarcode(toFullAscii('abc@123'), { narrow: 2 });
    expect(decodeImage(image, { fullAscii: true })?.text).toBe('abc@123');
  });

  it('returns null for blank and noise images', () => {
    const blank: RgbaImage = {
      width: 200,
      height: 100,
      data: new Uint8ClampedArray(200 * 100 * 4).fill(200),
    };
    expect(decodeImage(blank)).toBeNull();
    expect(decodeImage(renderNoise(400, 300))).toBeNull();
  });

  it('rejects invalid input at the API boundary', () => {
    const tooSmall = { width: 10, height: 10, data: new Uint8ClampedArray(10) };
    expect(() => decodeImage(tooSmall)).toThrow(InvalidArgumentError);
    expect(() => decodeImage(null as unknown as RgbaImage)).toThrow(InvalidArgumentError);
  });

  it('explains how to pass single-channel images', () => {
    const gray = toGrayscale(renderBarcode(TEXT, { narrow: 2 })) as unknown as RgbaImage;
    expect(() => decodeImage(gray)).toThrow(/luminanceFromGray/);
  });

  it('validates options', () => {
    expect(() => new Code39ImageDecoder({ scanLines: 0 })).toThrow(InvalidOptionsError);
    expect(() => new Code39ImageDecoder({ orientations: [] })).toThrow(InvalidOptionsError);
    expect(() => new Code39ImageDecoder({ orientations: ['diagonal' as ScanOrientation] })).toThrow(
      InvalidOptionsError,
    );
    expect(() => new Code39ImageDecoder({ scanLines: 2, minConfirmations: 5 })).toThrow(
      InvalidOptionsError,
    );
  });
});

describe('Code39ImageDecoder', () => {
  it('accepts RGBA images and luminance sources alike', () => {
    const image = renderBarcode(TEXT, { narrow: 2 });
    const decoder = new Code39ImageDecoder();
    expect(decoder.decode(image)?.text).toBe(TEXT);
    expect(decoder.decode(luminanceFromRgba(image))?.text).toBe(TEXT);
  });

  it('does not confirm a pattern seen only on nearly identical adjacent lines', () => {
    // A 2px-tall "barcode" (rows 49–50 of 100) is far below the Code 39 minimum bar height (15%
    // of its length), like text or a texture that happens to decode. With phase 0.8 the primary
    // line at row 49 decodes it, but no independent line can confirm it.
    const source = luminanceFromRgba(
      renderBarcode(TEXT, { narrow: 2, height: 100, barHeight: 0.03 }),
    );
    const decoder = (minConfirmations: number) =>
      new Code39ImageDecoder({ ...HORIZONTAL_ONLY, minConfirmations });
    expect(decoder(2).decode(source, { linePhase: 0.8 })).toBeNull();
    expect(decoder(1).decode(source, { linePhase: 0.8 })?.text).toBe(TEXT);
  });

  it('confirms a short barcode crossed by a single primary line', () => {
    // 1080 rows / 24 lines = 45px spacing. The 30px-tall barcode (rows 525–554, the spec
    // minimum for its length) lies between the lines at phase 0.5 (rows 517 and 562). At phase
    // 0.1 one line (row 544) crosses it and a probe (row 534) independently confirms it.
    const source = luminanceFromRgba(
      renderBarcode('SMALL', { narrow: 2, height: 1080, barHeight: 30 / 1080 }),
    );
    const decoder = new Code39ImageDecoder(HORIZONTAL_ONLY);
    expect(decoder.decode(source, { linePhase: 0.5 })).toBeNull();
    expect(decoder.decode(source, { linePhase: 0.1 })?.text).toBe('SMALL');
  });

  it('finds two barcodes stacked vertically', () => {
    const top = renderBarcode('TOP', { narrow: 2, height: 60, barHeight: 0.9 });
    const bottom = renderBarcode('BOTTOM', { narrow: 2, height: 60, barHeight: 0.9 });
    const image = composeImages(Math.max(top.width, bottom.width), 120, [
      { image: top, x: 0, y: 0 },
      { image: bottom, x: 0, y: 60 },
    ]);
    const texts = new Code39ImageDecoder(HORIZONTAL_ONLY)
      .decodeAll(image)
      .map((r) => r.text)
      .sort();
    expect(texts).toEqual(['BOTTOM', 'TOP']);
  });

  it('finds two barcodes side by side on the same scanlines', () => {
    const left = renderBarcode('LEFT', { narrow: 2, height: 80 });
    const right = renderBarcode('RIGHT', { narrow: 2, height: 80 });
    const image = composeImages(left.width + right.width, 80, [
      { image: left, x: 0, y: 0 },
      { image: right, x: left.width, y: 0 },
    ]);
    const texts = new Code39ImageDecoder(HORIZONTAL_ONLY).decodeAll(image).map((r) => r.text);
    expect(texts).toEqual(['LEFT', 'RIGHT']);
  });

  it('validates the line phase', () => {
    const image = renderBarcode(TEXT, { narrow: 2 });
    for (const linePhase of [-0.1, 1.5, Number.NaN]) {
      expect(() => new Code39ImageDecoder().decode(image, { linePhase })).toThrow(
        InvalidOptionsError,
      );
    }
  });
});

describe('binarizeLine', () => {
  it('returns null for flat or tiny lines', () => {
    expect(binarizeLine(new Uint8Array(100).fill(128))).toBeNull();
    expect(binarizeLine([0, 255])).toBeNull();
  });

  it('always starts and ends with a light run', () => {
    const line = new Uint8Array(40).fill(20);
    line.fill(230, 5, 35);
    const runs = binarizeLine(line)!;
    expect(runs).toHaveLength(5);
    expect(runs[0]).toBe(0);
    expect(runs[4]).toBe(0);
    expect(runs[1]).toBeCloseTo(5, 0);
    expect(runs[3]).toBeCloseTo(5, 0);
    expect(runs.reduce((a, b) => a + b, 0)).toBeCloseTo(40, 5);
  });

  it('classifies regions without local contrast as light (quiet zones, margins)', () => {
    // Dark areas farther than the window radius from any edge have no local reference.
    const line = new Uint8Array(200).fill(20);
    line.fill(230, 100, 200);
    const runs = binarizeLine(line)!;
    expect(runs).toHaveLength(3);
    expect(runs[1]).toBeGreaterThan(0);
    // Only the dark pixels within the window radius (round(200/16) = 13) of the edge stay dark,
    // plus up to 1px of smoothing-kernel spread and half a pixel of edge interpolation.
    expect(runs[1]).toBeLessThanOrEqual(13 + 1 + 0.5);
  });

  it('places edges with sub-pixel precision', () => {
    const { data, width } = toGrayscale(
      renderBarcode('A', { narrow: 1.5, height: 3, barHeight: 1 }),
    );
    const runs = binarizeLine(data.subarray(width, 2 * width))!;
    const narrowBars = runs.filter((w, i) => i % 2 === 1 && w < 2.5);
    for (const w of narrowBars) expect(w).toBeCloseTo(1.5, 0);
  });
});
