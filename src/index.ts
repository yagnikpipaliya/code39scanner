// Live scanning
export {
  Code39Scanner,
  ScannerEvent,
  ScannerState,
  type Code39ScannerOptions,
  type ScannerEventMap,
} from './camera/scanner.js';
export {
  CameraFrameSource,
  type CameraDevice,
  type CameraFrameSourceOptions,
} from './camera/camera-frame-source.js';
export type { FrameSource, StartOptions } from './camera/frame-source.js';
export { PresenceTracker } from './camera/presence-tracker.js';
export type { Clock } from './clock.js';

// Decoding building blocks
export { Code39ImageDecoder, decodeImage } from './image/image-decoder.js';
export {
  luminanceFromGray,
  luminanceFromRgba,
  toGrayscale,
  toLuminanceSource,
  type ImageInput,
  type LuminanceSource,
} from './image/luminance.js';
export { binarizeLine } from './image/scanline-binarizer.js';
export { Code39WidthDecoder, type LineSymbol, type Runs } from './core/width-decoder.js';
export { expandFullAscii } from './core/full-ascii.js';
export { CODE39_ALPHABET } from './core/symbology.js';

// Configuration, types and errors
export {
  DEFAULT_SCANNER_OPTIONS,
  FRAME_CONFIRMATION_WINDOW,
  type DecodeOptions,
  type ImageDecodeOptions,
  type ScannerOptions,
  type ScanPassOptions,
} from './options.js';
export {
  BarcodeFormat,
  ScanOrientation,
  type DecodedBarcode,
  type GrayImage,
  type RgbaImage,
  type ScanResult,
} from './types.js';
export type { EnumValue } from './utils/enum.js';
export type { Listener } from './events.js';
export {
  CameraUnavailableError,
  Code39ScannerError,
  ErrorCode,
  FrameProcessingError,
  InsecureContextError,
  InvalidArgumentError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from './errors.js';
