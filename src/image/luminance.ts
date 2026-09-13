import type { GrayImage, RgbaImage } from '../types.js';

/**
 * Line-oriented access to image luminance. The decoder only samples a few dozen scanlines, so
 * converting just those lines (instead of the whole frame) keeps full camera resolution cheap.
 */
export interface LuminanceSource {
  readonly width: number;
  readonly height: number;
  row(y: number): Uint8Array;
  column(x: number): Uint8Array;
}

/** Validates image dimensions against its buffer size. */
export function assertImage(image: RgbaImage | GrayImage, bytesPerPixel: 1 | 4): void {
  const { width, height, data } = image ?? {};
  const valid =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    data !== undefined &&
    data.length >= width * height * bytesPerPixel;
  if (!valid) {
    throw new TypeError(
      `Invalid image: expected positive integer width/height and at least width*height*${bytesPerPixel} bytes of data.`,
    );
  }
}

/** Integer Rec. 601 luma of the RGBA pixel starting at byte offset `p`. */
const luma = (data: RgbaImage['data'], p: number): number =>
  (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;

export function rgbaLuminance(image: RgbaImage): LuminanceSource {
  assertImage(image, 4);
  const { width, height, data } = image;
  const stride = width * 4;
  return {
    width,
    height,
    row(y) {
      const line = new Uint8Array(width);
      for (let x = 0, p = y * stride; x < width; x++, p += 4) line[x] = luma(data, p);
      return line;
    },
    column(x) {
      const line = new Uint8Array(height);
      for (let y = 0, p = x * 4; y < height; y++, p += stride) line[y] = luma(data, p);
      return line;
    },
  };
}

export function grayLuminance(image: GrayImage): LuminanceSource {
  assertImage(image, 1);
  const { width, height, data } = image;
  return {
    width,
    height,
    row: (y) => data.subarray(y * width, (y + 1) * width),
    column(x) {
      const line = new Uint8Array(height);
      for (let y = 0; y < height; y++) line[y] = data[y * width + x]!;
      return line;
    },
  };
}

/** Converts a whole RGBA image to luminance. */
export function toGrayscale(image: RgbaImage): GrayImage {
  assertImage(image, 4);
  const { width, height, data } = image;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = luma(data, i * 4);
  return { width, height, data: gray };
}
