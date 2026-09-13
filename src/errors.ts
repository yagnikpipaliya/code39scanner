/** Base class for all errors thrown by this package. */
export class Code39ScannerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid configuration passed to a public API. */
export class InvalidOptionsError extends Code39ScannerError {}

/** The browser lacks the APIs required for camera scanning. */
export class UnsupportedBrowserError extends Code39ScannerError {}

/** Camera access requires a secure context (HTTPS or localhost). */
export class InsecureContextError extends Code39ScannerError {}

/** The user or browser policy denied camera access. */
export class PermissionDeniedError extends Code39ScannerError {}

/** No usable camera: none found, already in use, or the stream ended. */
export class CameraUnavailableError extends Code39ScannerError {}
