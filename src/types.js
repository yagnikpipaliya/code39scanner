import { defineEnum } from './utils.js';

/** RGBA pixel buffer (4 bytes per pixel). Structurally compatible with the DOM `ImageData`. */
/**
 * @typedef {{
 *   readonly width: number;
 *   readonly height: number;
 *   readonly data: Uint8ClampedArray | Uint8Array;
 * }} RgbaImage
 */

/** Luminance pixel buffer (1 byte per pixel). */
/**
 * @typedef {{
 *   readonly width: number;
 *   readonly height: number;
 *   readonly data: Uint8Array;
 * }} GrayImage
 */

/**
 * Line-oriented access to image luminance. The decoder reads only the scanlines it samples,
 * so sources convert (or even fetch) just those lines instead of the whole frame.
 *
 * A source may be a view over a buffer that changes between frames (e.g. a camera canvas):
 * read its lines synchronously, before the next frame is captured.
 * @typedef {{
 *   readonly width: number;
 *   readonly height: number;
 *   row: (y: number) => Uint8Array;
 *   column: (x: number) => Uint8Array;
 * }} LuminanceSource
 */

/** Anything the decoder accepts: a luminance source, or an RGBA image such as `ImageData`. */
/** @typedef {LuminanceSource | RgbaImage} ImageInput */

/** Direction of the sampled scanlines. */
export const ScanOrientation = defineEnum({
  Horizontal: 'horizontal',
  Vertical: 'vertical',
});

export const BarcodeFormat = defineEnum({
  Code39: 'CODE_39',
});

/** A successfully decoded barcode. */
/**
 * @typedef {{
 *   readonly text: string;
 *   readonly rawText: string;
 *   readonly format: BarcodeFormat;
 * }} DecodedBarcode
 */

/** A barcode detected by the live scanner. */
/**
 * @typedef {{
 *   readonly text: string;
 *   readonly rawText: string;
 *   readonly format: BarcodeFormat;
 *   readonly timestamp: number;
 * }} ScanResult
 */

/**
 * @typedef {{
 *   readonly deviceId?: string | undefined;
 * }} StartOptions
 */

/**
 * Abstraction over anything that can supply frames to the scanner. The camera implementation
 * is `CameraFrameSource`; tests and custom inputs provide their own.
 * @typedef {{
 *   start: (options: StartOptions) => Promise<void>;
 *   stop: () => void;
 *   grabFrame: () => LuminanceSource | null;
 *   readonly isActive: boolean;
 *   readonly activeDeviceId?: string | undefined;
 * }} FrameSource
 */