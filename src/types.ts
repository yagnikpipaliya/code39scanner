import { defineEnum, type EnumValue } from './utils/enum.js';

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
