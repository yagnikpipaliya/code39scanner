import { InvalidArgumentError } from '../errors.js';

/** Dimensions may be 0: an empty image (e.g. a camera still warming up) contains no barcode. */
const isDimension = (value) =>
  Number.isInteger(value) && value >= 0;

function hasImageShape(value, bytesPerPixel) {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height, data } = value;
  return (
    isDimension(width) &&
    isDimension(height) &&
    typeof data?.length === 'number' &&
    data.length >= width * height * bytesPerPixel
  );
}

function isLuminanceSource(value) {
  if (typeof value !== 'object' || value === null) return false;
  const source = value;
  return (
    isDimension(source.width) &&
    isDimension(source.height) &&
    typeof source.row === 'function' &&
    typeof source.column === 'function'
  );
}

/** Validates image dimensions against its buffer size. */
export function assertImage(image, bytesPerPixel) {
  if (!hasImageShape(image, bytesPerPixel)) {
    throw new InvalidArgumentError(
      `Invalid image: expected non-negative integer width/height and at least width × height × ${bytesPerPixel} bytes of data.`,
    );
  }
}

/**
 * Converts `count` RGBA pixels to luminance (integer Rec. 601 weights). Pixels start at byte
 * `offset` and are `stride` bytes apart (4 for a row, `width * 4` for a column).
 */
export function lumaLine(data, count, offset = 0, stride = 4) {
  const line = new Uint8Array(count);
  for (let i = 0, p = offset; i < count; i++, p += stride) {
    line[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return line;
}

/** Luminance source over an RGBA image (e.g. `ImageData`). */
export function luminanceFromRgba(image) {
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
export function luminanceFromGray(image) {
  assertImage(image, 1);
  const { width, height, data } = image;
  return {
    width,
    height,
    row: (y) => data.subarray(y * width, (y + 1) * width),
    column(x) {
      const line = new Uint8Array(height);
      for (let y = 0; y < height; y++) line[y] = data[y * width + x];
      return line;
    },
  };
}

/**
 * Normalizes decoder input: luminance sources pass through, RGBA images are wrapped.
 * Anything else fails here, at the API boundary, with an actionable message.
 */
export function toLuminanceSource(input) {
  if (isLuminanceSource(input)) return input;
  if (hasImageShape(input, 4)) return luminanceFromRgba(input);
  throw new InvalidArgumentError(
    'Expected an RGBA image such as ImageData (width × height × 4 bytes) or a LuminanceSource. ' +
      'Wrap single-channel images with luminanceFromGray().',
  );
}

/** Converts a whole RGBA image to luminance. */
export function toGrayscale(image) {
  assertImage(image, 4);
  const { width, height, data } = image;
  return { width, height, data: lumaLine(data, width * height) };
}