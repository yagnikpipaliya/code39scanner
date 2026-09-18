// Live scanning
export { Code39Scanner, ScannerEvent, ScannerState } from './camera/scanner.js';
export { CameraFrameSource } from './camera/camera-frame-source.js';
export { PresenceTracker } from './camera/presence-tracker.js';

// Decoding building blocks
export { Code39ImageDecoder, decodeImage } from './image/image-decoder.js';
export {
  luminanceFromGray,
  luminanceFromRgba,
  toGrayscale,
  toLuminanceSource,
} from './image/luminance.js';
export { binarizeLine } from './image/scanline-binarizer.js';
export { Code39WidthDecoder } from './core/width-decoder.js';
export { CODE39_ALPHABET, expandFullAscii } from './core/symbology.js';

// Configuration, types and errors
export { DEFAULT_SCANNER_OPTIONS, FRAME_CONFIRMATION_WINDOW } from './options.js';
export { BarcodeFormat, ScanOrientation } from './types.js';
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
