import { defineEnum, type EnumValue } from '@/utils.js';

/** RGBA pixel buffer (4 bytes per pixel). Structurally compatible with the DOM `ImageData`. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** Luminance pixel buffer (1 byte per pixel). */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

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

/** Anything the decoder accepts: a luminance source, or an RGBA image such as `ImageData`. */
export type ImageInput = LuminanceSource | RgbaImage;

/** Direction of the sampled scanlines. */
export const ScanOrientation = defineEnum({
  Horizontal: 'horizontal',
  Vertical: 'vertical',
});
export type ScanOrientation = EnumValue<typeof ScanOrientation>;

export const BarcodeFormat = defineEnum({
  Code39: 'CODE_39',
});
export type BarcodeFormat = EnumValue<typeof BarcodeFormat>;

/** A successfully decoded barcode. */
export interface DecodedBarcode {
  /**
   * Decoded payload. With `fullAscii` enabled, shift sequences are expanded; a payload that is
   * not valid Full ASCII is returned unchanged (it is then plain Code 39).
   */
  readonly text: string;
  /** Payload exactly as encoded in the symbol, without start/stop characters. */
  readonly rawText: string;
  readonly format: BarcodeFormat;
}

/** A barcode detected by the live scanner. */
export interface ScanResult extends DecodedBarcode {
  /** Detection time, milliseconds since the Unix epoch. */
  readonly timestamp: number;
}

export interface StartOptions {
  /** Camera to use. When omitted, the rear ("environment") camera is preferred. */
  readonly deviceId?: string | undefined;
}

/**
 * Abstraction over anything that can supply frames to the scanner. The camera implementation
 * is `CameraFrameSource`; tests and custom inputs provide their own.
 */
export interface FrameSource {
  start(options: StartOptions): Promise<void>;
  stop(): void;
  /** The current frame, or `null` if none is ready yet. Valid until the next call. */
  grabFrame(): LuminanceSource | null;
  /** `false` once stopped or if the underlying stream ended. */
  readonly isActive: boolean;
  readonly activeDeviceId?: string | undefined;
}
