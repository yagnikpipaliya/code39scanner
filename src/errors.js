import { defineEnum } from './utils.js';

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

/**
 * Base class for every error thrown or emitted by this package. Each subclass declares its
 * `name` as a string literal (class names do not survive minification) and a stable `code`.
 */
export class Code39ScannerError extends Error {
  /** @type {ErrorCode} */
  get code() {
    throw new Error('code must be implemented by subclass');
  }
}

/** Invalid configuration passed to a constructor. */
export class InvalidOptionsError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'InvalidOptionsError';
  }
  get code() { return ErrorCode.InvalidOptions; }
}

/** Invalid input passed to a method (an image, a listener, a device id, …). */
export class InvalidArgumentError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'InvalidArgumentError';
  }
  get code() { return ErrorCode.InvalidArgument; }
}

/** The browser lacks an API required for camera scanning (camera or 2D canvas). */
export class UnsupportedBrowserError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedBrowserError';
  }
  get code() { return ErrorCode.UnsupportedBrowser; }
}

/** Camera access requires a secure context (HTTPS or localhost). */
export class InsecureContextError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'InsecureContextError';
  }
  get code() { return ErrorCode.InsecureContext; }
}

/** The user or browser policy denied camera access. */
export class PermissionDeniedError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
  get code() { return ErrorCode.PermissionDenied; }
}

/** No usable camera: none found, already in use, or the stream ended. */
export class CameraUnavailableError extends Code39ScannerError {
  constructor(message) {
    super(message);
    this.name = 'CameraUnavailableError';
  }
  get code() { return ErrorCode.CameraUnavailable; }
}

/** An asynchronous operation was superseded by a later call (e.g. `stop()` during `start()`). */
export class OperationCancelledError extends Code39ScannerError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'OperationCancelledError';
  }
  get code() { return ErrorCode.OperationCancelled; }

  /**
   * `operation` (e.g. "Camera start") was superseded; `cause` is what it failed with, if anything.
   * @param {string} operation
   * @param {unknown} [cause]
   * @returns {OperationCancelledError}
   */
  static superseded(operation, cause) {
    return new OperationCancelledError(
      `${operation} was cancelled by a later start(), stop() or dispose() call.`,
      { cause },
    );
  }
}

/** A camera frame could not be processed; `cause` holds the original error. */
export class FrameProcessingError extends Code39ScannerError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'FrameProcessingError';
  }
  get code() { return ErrorCode.FrameProcessingFailed; }
}