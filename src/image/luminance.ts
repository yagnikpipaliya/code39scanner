import type { GrayImage, RgbaImage } from '../types.js';

/**
 * Line-oriented access to image luminance. The decoder reads only the scanlines it samples,
 * so sources convert (or even fetch) just those lines instead of the whole frame.
 *
 * A source may be a view over a buffer that changes between frames (e.g. a camera canvas):
 * read its lines synchronously, before the next frame is captured.
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

/**
 * Converts `count` RGBA pixels to luminance (integer Rec. 601 weights). Pixels start at byte
 * `offset` and are `stride` bytes apart (4 for a row, `width * 4` for a column).
 */
export function lumaLine(
  data: ArrayLike<number>,
  count: number,
  offset = 0,
  stride = 4,
): Uint8Array {
  const line = new Uint8Array(count);
  for (let i = 0, p = offset; i < count; i++, p += stride) {
    line[i] = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
  }
  return line;
}

/** Luminance source over an RGBA image (e.g. `ImageData`). */
export function luminanceFromRgba(image: RgbaImage): LuminanceSource {
  assertImage(image, 4);
  const { width, height, data } = image;
  const stride = width * 4;
  return {
    width,
    height,
    row: (y) => lumaLine(data, width, y * stride),
    column: (x) => lumaLine(data, height, x * 4, stride),
  };
}

/** Luminance source over a single-channel image. */
export function luminanceFromGray(image: GrayImage): LuminanceSource {
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
  return { width, height, data: lumaLine(data, width * height) };
}
