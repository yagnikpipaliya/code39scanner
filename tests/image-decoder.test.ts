import { describe, expect, it } from 'vitest';
import { InvalidArgumentError, InvalidOptionsError } from '@/errors.js';
import { Code39ImageDecoder, decodeImage } from '@/image/image-decoder.js';
import { luminanceFromRgba, toGrayscale } from '@/image/luminance.js';
import { binarizeLine } from '@/image/scanline-binarizer.js';
import { ScanOrientation, type RgbaImage } from '@/types.js';
import {
  composeImages,
  renderBarcode,
  renderNoise,
  rotate,
  rotate180,
  rotate90,
  toFullAscii,
} from '@tests/helpers.js';

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

  it.each([7, -7])(
    'decodes a barcode tilted by %s° with bars of spec-minimum height',
    (degrees) => {
      // 60px bars on a ~375px symbol (16% of its length). At 7° one horizontal line stays within
      // the bars end to end for only 60 − 375 · tan 7° ≈ 14px of height, so confirming lines must
      // fit in that window (they need 3 modules = 6px, not a fraction of the symbol length).
      const image = rotate(
        renderBarcode(TEXT, { narrow: 2, height: 100, barHeight: 0.6 }),
        degrees,
      );
      expect(decodeImage(image)?.text).toBe(TEXT);
    },
  );

  it('decodes long barcodes with short bars (about 5% of their length)', () => {
    const image = renderBarcode(TEXT, { narrow: 4, height: 60, barHeight: 0.6 });
    expect(decodeImage(image)?.text).toBe(TEXT);
  });

  it('decodes Full ASCII when enabled', () => {
    const image = renderBarcode(toFullAscii('abc@123'), { narrow: 2 });
    expect(decodeImage(image, { fullAscii: true })?.text).toBe('abc@123');
  });

  it('returns null for blank, noise and empty images', () => {
    const blank: RgbaImage = {
      width: 200,
      height: 100,
      data: new Uint8ClampedArray(200 * 100 * 4).fill(200),
    };
    expect(decodeImage(blank)).toBeNull();
    expect(decodeImage(renderNoise(400, 300))).toBeNull();
    expect(decodeImage({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });

  it('rejects invalid input at the API boundary', () => {
    const tooSmall = { width: 10, height: 10, data: new Uint8ClampedArray(10) };
    expect(() => decodeImage(tooSmall)).toThrow(InvalidArgumentError);
    expect(() => decodeImage({ width: -1, height: 1, data: new Uint8ClampedArray(4) })).toThrow(
      InvalidArgumentError,
    );
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
    expect(() => new Code39ImageDecoder({ minConfirmations: 0 })).toThrow(InvalidOptionsError);
    expect(() => new Code39ImageDecoder({ minConfirmations: 11 })).toThrow(InvalidOptionsError);
  });

  it('reaches the maximum confirmation count on an ordinary barcode', () => {
    // 60px bars and 6px confirmation spacing leave room for 10 independent lines.
    const image = renderBarcode(TEXT, { narrow: 2, height: 100, barHeight: 0.6 });
    expect(decodeImage(image, { minConfirmations: 10 })?.text).toBe(TEXT);
  });
});

describe('Code39ImageDecoder', () => {
  /** 30px-tall bars (rows 525–554 of 1080) on a ~200px symbol: the spec minimum for its length. */
  const shortBarcode = () =>
    luminanceFromRgba(renderBarcode('SMALL', { narrow: 2, height: 1080, barHeight: 30 / 1080 }));

  it('accepts RGBA images and luminance sources alike', () => {
    const image = renderBarcode(TEXT, { narrow: 2 });
    const decoder = new Code39ImageDecoder();
    expect(decoder.decode(image)?.text).toBe(TEXT);
    expect(decoder.decode(luminanceFromRgba(image))?.text).toBe(TEXT);
  });

  it('treats an empty luminance source as containing no barcode', () => {
    const empty = {
      width: 0,
      height: 0,
      row: () => new Uint8Array(0),
      column: () => new Uint8Array(0),
    };
    expect(new Code39ImageDecoder().decodeAll(empty)).toEqual([]);
  });

  it('does not confirm a pattern seen only on nearly identical adjacent rows', () => {
    // A 2px-tall "barcode" (rows 49–50 of 100), like text or a texture that happens to decode.
    // With phase 0.8 the primary line at row 49 decodes it, but confirming lines must be
    // 3 modules (6px) apart, and nothing 6px away decodes the same value.
    const source = luminanceFromRgba(
      renderBarcode(TEXT, { narrow: 2, height: 100, barHeight: 0.03 }),
    );
    const decoder = (minConfirmations: number) =>
      new Code39ImageDecoder({ ...HORIZONTAL_ONLY, minConfirmations });
    expect(decoder(2).decode(source, { linePhase: 0.8 })).toBeNull();
    expect(decoder(1).decode(source, { linePhase: 0.8 })?.text).toBe(TEXT);
  });

  it('confirms a short barcode crossed by a single primary line', () => {
    // 1080 rows / 24 lines = 45px spacing. At phase 0.5 the lines (rows 517 and 562) miss the
    // bars; at phase 0.1 the line at row 544 crosses them and the walk along the bars confirms.
    const decoder = new Code39ImageDecoder(HORIZONTAL_ONLY);
    expect(decoder.decode(shortBarcode(), { linePhase: 0.5 })).toBeNull();
    expect(decoder.decode(shortBarcode(), { linePhase: 0.1 })?.text).toBe('SMALL');
  });

  it('walks along the bars to collect as many confirmations as they are tall', () => {
    // From the hit at row 544 the walk finds rows 526, 532, 538 and 550 (6px apart): five
    // independent lines within the 30px bars, and no more.
    const decoder = (minConfirmations: number) =>
      new Code39ImageDecoder({ ...HORIZONTAL_ONLY, minConfirmations });
    expect(decoder(5).decode(shortBarcode(), { linePhase: 0.1 })?.text).toBe('SMALL');
    expect(decoder(6).decode(shortBarcode(), { linePhase: 0.1 })).toBeNull();
  });

  it('confirms same-text labels of different sizes independently, each at its own spacing', () => {
    // The large label (6px modules → 18px spacing) is only 3 rows tall and is crossed first (it
    // sits at the image center), so it can never confirm. The small label (2px modules → 6px
    // spacing, 15 rows tall) confirms on its own; its lines must not be judged at 18px.
    const large = renderBarcode('DUP', { narrow: 6, height: 3, barHeight: 1 });
    const small = renderBarcode('DUP', { narrow: 2, height: 15, barHeight: 1 });
    const image = composeImages(large.width, 240, [
      { image: large, x: 0, y: 114 },
      { image: small, x: 0, y: 180 },
    ]);
    const texts = new Code39ImageDecoder(HORIZONTAL_ONLY).decodeAll(image).map((r) => r.text);
    expect(texts).toEqual(['DUP']);
  });

  it('adds up support from lines that measure slightly different bar widths', () => {
    // One label crossed by two primary lines (rows 47 and 56 of 100) that read its bars as 2.4 px
    // and 2.6 px (e.g. through tilt or blur). Each row is 1px tall, so walking finds nothing
    // more: the two lines must count together, as one symbol size, to reach 2 confirmations.
    const thinner = renderBarcode(TEXT, { narrow: 2.4, height: 1, barHeight: 1 });
    const wider = renderBarcode(TEXT, { narrow: 2.6, height: 1, barHeight: 1 });
    const image = composeImages(Math.max(thinner.width, wider.width), 100, [
      { image: thinner, x: 0, y: 47 },
      { image: wider, x: 0, y: 56 },
    ]);
    expect(new Code39ImageDecoder(HORIZONTAL_ONLY).decode(image)?.text).toBe(TEXT);
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
