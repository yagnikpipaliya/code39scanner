import { defineEnum, type EnumValue } from './utils/enum.js';

/** Stable, machine-readable error identifiers (safe to switch on or map to messages). */
export const ErrorCode = defineEnum({
  InvalidOptions: 'INVALID_OPTIONS',
  UnsupportedBrowser: 'UNSUPPORTED_BROWSER',
  InsecureContext: 'INSECURE_CONTEXT',
  PermissionDenied: 'PERMISSION_DENIED',
  CameraUnavailable: 'CAMERA_UNAVAILABLE',
  OperationCancelled: 'OPERATION_CANCELLED',
});
export type ErrorCode = EnumValue<typeof ErrorCode>;

/**
 * Base class for all errors thrown by this package. Every subclass declares its `name` as a
 * string literal (class names do not survive minification) and a stable `code`.
 */
export abstract class Code39ScannerError extends Error {
  abstract readonly code: ErrorCode;
}

/** Invalid configuration passed to a public API. */
export class InvalidOptionsError extends Code39ScannerError {
  override readonly name = 'InvalidOptionsError';
  readonly code = ErrorCode.InvalidOptions;
}

/** The browser lacks the APIs required for camera scanning. */
export class UnsupportedBrowserError extends Code39ScannerError {
  override readonly name = 'UnsupportedBrowserError';
  readonly code = ErrorCode.UnsupportedBrowser;
}

/** Camera access requires a secure context (HTTPS or localhost). */
export class InsecureContextError extends Code39ScannerError {
  override readonly name = 'InsecureContextError';
  readonly code = ErrorCode.InsecureContext;
}

/** The user or browser policy denied camera access. */
export class PermissionDeniedError extends Code39ScannerError {
  override readonly name = 'PermissionDeniedError';
  readonly code = ErrorCode.PermissionDenied;
}

/** No usable camera: none found, already in use, or the stream ended. */
export class CameraUnavailableError extends Code39ScannerError {
  override readonly name = 'CameraUnavailableError';
  readonly code = ErrorCode.CameraUnavailable;
}

/** An asynchronous operation was superseded by a later call (e.g. `stop()` during `start()`). */
export class OperationCancelledError extends Code39ScannerError {
  override readonly name = 'OperationCancelledError';
  readonly code = ErrorCode.OperationCancelled;
}
