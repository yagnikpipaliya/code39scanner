import { defineEnum } from './utils.js';

/**
 * RGBA pixel buffer (4 bytes per pixel). Structurally compatible with the DOM `ImageData`.
 * @typedef {object} RgbaImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray | Uint8Array} data
 */

/**
 * Luminance pixel buffer (1 byte per pixel).
 * @typedef {object} GrayImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 */

/**
 * Line-oriented access to image luminance. The decoder reads only the scanlines it samples,
 * so sources convert (or even fetch) just those lines instead of the whole frame.
 *
 * A source may be a view over a buffer that changes between frames (e.g. a camera canvas):
 * read its lines synchronously, before the next frame is captured.
 * @typedef {object} LuminanceSource
 * @property {number} width
 * @property {number} height
 * @property {(y: number) => Uint8Array} row
 * @property {(x: number) => Uint8Array} column
 */

/**
 * Anything the decoder accepts: a luminance source, or an RGBA image such as `ImageData`.
 * @typedef {LuminanceSource | RgbaImage} ImageInput
 */

/** Direction of the sampled scanlines. */
export const ScanOrientation = defineEnum({
  Horizontal: 'horizontal',
  Vertical: 'vertical',
});

export const BarcodeFormat = defineEnum({
  Code39: 'CODE_39',
});

/**
 * A successfully decoded barcode.
 * @typedef {object} DecodedBarcode
 * @property {string} text Decoded payload. With `fullAscii` enabled, shift sequences are
 *   expanded; a payload that is not valid Full ASCII is returned unchanged (it is then plain
 *   Code 39).
 * @property {string} rawText Payload exactly as encoded in the symbol, without start/stop
 *   characters.
 * @property {string} format A {@link BarcodeFormat} value.
 */

/**
 * A barcode detected by the live scanner.
 * @typedef {DecodedBarcode & { timestamp: number }} ScanResult `timestamp` is the detection
 *   time, milliseconds since the Unix epoch.
 */

/**
 * @typedef {object} StartOptions
 * @property {string} [deviceId] Camera to use. When omitted, the rear ("environment") camera is
 *   preferred.
 */

/**
 * Abstraction over anything that can supply frames to the scanner. The camera implementation
 * is `CameraFrameSource`; tests and custom inputs provide their own.
 * @typedef {object} FrameSource
 * @property {(options: StartOptions) => Promise<void>} start
 * @property {() => void} stop
 * @property {() => LuminanceSource | null} grabFrame The current frame, or `null` if none is
 *   ready yet. Valid until the next call.
 * @property {boolean} isActive `false` once stopped or if the underlying stream ended.
 * @property {string} [activeDeviceId]
 */
