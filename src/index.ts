// Live scanning
export {
  Code39Scanner,
  type Code39ScannerOptions,
  type ScannerEventMap,
  type ScannerState,
} from './camera/scanner.js';
export {
  CameraFrameSource,
  type CameraDevice,
  type CameraFrameSourceOptions,
} from './camera/camera-frame-source.js';
export type { FrameSource, StartOptions } from './camera/frame-source.js';
export { PresenceTracker } from './camera/presence-tracker.js';

// Decoding building blocks
export { Code39ImageDecoder, decodeImage } from './image/image-decoder.js';
export { toGrayscale } from './image/luminance.js';
export { binarizeLine } from './image/scanline-binarizer.js';
export { Code39WidthDecoder, type Runs } from './core/width-decoder.js';
export { expandFullAscii } from './core/full-ascii.js';
export { CODE39_ALPHABET } from './core/symbology.js';

// Configuration, types and errors
export {
  DEFAULT_SCANNER_OPTIONS,
  type DecodeOptions,
  type ImageDecodeOptions,
  type ScannerOptions,
} from './options.js';
export {
  BARCODE_FORMAT,
  type DecodedBarcode,
  type GrayImage,
  type RgbaImage,
  type ScanOrientation,
  type ScanResult,
} from './types.js';
export type { Listener } from './events.js';
export {
  CameraUnavailableError,
  Code39ScannerError,
  InsecureContextError,
  InvalidOptionsError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from './errors.js';
