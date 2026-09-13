import { defineEnum, type EnumValue } from '@/utils.js';

/** Stable, machine-readable error identifiers (safe to switch on or map to messages). */
export const ErrorCode = defineEnum({
  InvalidOptions: 'INVALID_OPTIONS',
  InvalidArgument: 'INVALID_ARGUMENT',
  UnsupportedBrowser: 'UNSUPPORTED_BROWSER',
  InsecureContext: 'INSECURE_CONTEXT',
  PermissionDenied: 'PERMISSION_DENIED',
  CameraUnavailable: 'CAMERA_UNAVAILABLE',
  OperationCancelled: 'OPERATION_CANCELLED',
  FrameProcessingFailed: 'FRAME_PROCESSING_FAILED',
});
export type ErrorCode = EnumValue<typeof ErrorCode>;

/**
 * Base class for every error thrown or emitted by this package. Each subclass declares its
 * `name` as a string literal (class names do not survive minification) and a stable `code`.
 */
export abstract class Code39ScannerError extends Error {
  abstract readonly code: ErrorCode;
}

/** Invalid configuration passed to a constructor. */
export class InvalidOptionsError extends Code39ScannerError {
  override readonly name = 'InvalidOptionsError';
  readonly code = ErrorCode.InvalidOptions;
}

/** Invalid input passed to a method (an image, a listener, a device id, …). */
export class InvalidArgumentError extends Code39ScannerError {
  override readonly name = 'InvalidArgumentError';
  readonly code = ErrorCode.InvalidArgument;
}

/** The browser lacks an API required for camera scanning (camera or 2D canvas). */
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

  /** `operation` (e.g. "Camera start") was superseded; `cause` is what it failed with, if anything. */
  static superseded(operation: string, cause?: unknown): OperationCancelledError {
    return new OperationCancelledError(
      `${operation} was cancelled by a later start(), stop() or dispose() call.`,
      { cause },
    );
  }
}

/** A camera frame could not be processed; `cause` holds the original error. */
export class FrameProcessingError extends Code39ScannerError {
  override readonly name = 'FrameProcessingError';
  readonly code = ErrorCode.FrameProcessingFailed;
}
