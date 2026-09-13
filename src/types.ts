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

export type ScanOrientation = 'horizontal' | 'vertical';

export const BARCODE_FORMAT = 'CODE_39';

/** A successfully decoded barcode. */
export interface DecodedBarcode {
  /** Decoded payload (Full ASCII expanded when enabled). */
  readonly text: string;
  /** Payload exactly as encoded in the symbol, without start/stop characters. */
  readonly rawText: string;
  readonly format: typeof BARCODE_FORMAT;
}

/** A barcode detected by the live scanner. */
export interface ScanResult extends DecodedBarcode {
  /** Detection time, milliseconds since the Unix epoch. */
  readonly timestamp: number;
}
