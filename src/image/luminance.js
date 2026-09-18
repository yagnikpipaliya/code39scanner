import { InvalidArgumentError } from '../errors.js';

/**
 * @typedef {import('../types.js').GrayImage} GrayImage
 * @typedef {import('../types.js').ImageInput} ImageInput
 * @typedef {import('../types.js').LuminanceSource} LuminanceSource
 * @typedef {import('../types.js').RgbaImage} RgbaImage
 */

/**
 * Dimensions may be 0: an empty image (e.g. a camera still warming up) contains no barcode.
 * @param {unknown} value
 * @returns {value is number}
 */
const isDimension = (value) => Number.isInteger(value) && /** @type {number} */ (value) >= 0;

/**
 * @param {unknown} value
 * @param {1 | 4} bytesPerPixel
 * @returns {value is RgbaImage | GrayImage}
 */
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

/**
 * @param {unknown} value
 * @returns {value is LuminanceSource}
 */
function isLuminanceSource(value) {
  if (typeof value !== 'object' || value === null) return false;
  const source = /** @type {Partial<LuminanceSource>} */ (value);
  return (
    isDimension(source.width) &&
    isDimension(source.height) &&
    typeof source.row === 'function' &&
    typeof source.column === 'function'
  );
}

/**
 * Validates image dimensions against its buffer size.
 * @param {RgbaImage | GrayImage} image
 * @param {1 | 4} bytesPerPixel
 */
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
 * @param {ArrayLike<number>} data
 * @param {number} count
 * @param {number} [offset]
 * @param {number} [stride]
 * @returns {Uint8Array}
 */
export function lumaLine(data, count, offset = 0, stride = 4) {
  const line = new Uint8Array(count);
  for (let i = 0, p = offset; i < count; i++, p += stride) {
    line[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return line;
}

/**
 * Luminance source over an RGBA image (e.g. `ImageData`).
 * @param {RgbaImage} image
 * @returns {LuminanceSource}
 */
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

/**
 * Luminance source over a single-channel image.
 * @param {GrayImage} image
 * @returns {LuminanceSource}
 */
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
 * @param {unknown} input
 * @returns {LuminanceSource}
 */
export function toLuminanceSource(input) {
  if (isLuminanceSource(input)) return input;
  if (hasImageShape(input, 4)) return luminanceFromRgba(input);
  throw new InvalidArgumentError(
    'Expected an RGBA image such as ImageData (width × height × 4 bytes) or a LuminanceSource. ' +
      'Wrap single-channel images with luminanceFromGray().',
  );
}

/**
 * Converts a whole RGBA image to luminance.
 * @param {RgbaImage} image
 * @returns {GrayImage}
 */
export function toGrayscale(image) {
  assertImage(image, 4);
  const { width, height, data } = image;
  return { width, height, data: lumaLine(data, width * height) };
}
