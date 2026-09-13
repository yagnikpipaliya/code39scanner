import {
  CameraUnavailableError,
  InsecureContextError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
  type Code39ScannerError,
} from '../errors.js';
import { lumaLine, type LuminanceSource } from '../image/luminance.js';
import { DEFAULT_SCANNER_OPTIONS, validateNumberOption } from '../options.js';
import type { FrameSource, StartOptions } from './frame-source.js';

export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface CameraFrameSourceOptions {
  /** Frames are downscaled so their longest side is at most this many pixels. */
  readonly maxFrameSize?: number;
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type CameraErrorClass = new (message: string, options?: ErrorOptions) => Code39ScannerError;

/** `HTMLMediaElement.HAVE_CURRENT_DATA` without touching the DOM global at import time. */
const HAVE_CURRENT_DATA = 2;
const PREFERRED_FACING_MODE = 'environment';
const IDEAL_RESOLUTION = { width: 1920, height: 1080 } as const;

const CAMERA_BUSY_MESSAGE = 'The camera is in use by another application or could not be started.';
const NO_CAMERA_MESSAGE = 'No matching camera was found.';
const PERMISSION_MESSAGE = 'Camera permission was denied.';

/** `getUserMedia` DOMException name → typed error. */
const MEDIA_ERRORS: ReadonlyMap<string, readonly [CameraErrorClass, string]> = new Map([
  ['NotAllowedError', [PermissionDeniedError, PERMISSION_MESSAGE]],
  ['SecurityError', [PermissionDeniedError, PERMISSION_MESSAGE]],
  ['NotFoundError', [CameraUnavailableError, NO_CAMERA_MESSAGE]],
  ['OverconstrainedError', [CameraUnavailableError, NO_CAMERA_MESSAGE]],
  ['NotReadableError', [CameraUnavailableError, CAMERA_BUSY_MESSAGE]],
  ['AbortError', [CameraUnavailableError, CAMERA_BUSY_MESSAGE]],
]);
const UNKNOWN_MEDIA_ERROR: readonly [CameraErrorClass, string] = [
  CameraUnavailableError,
  'Unable to access the camera.',
];

const hasCameraApi = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

const hasCanvasApi = (): boolean =>
  typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';

function assertCameraAccess(): void {
  // Checked first: insecure contexts hide `navigator.mediaDevices` entirely.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new InsecureContextError('Camera access requires a secure context (HTTPS or localhost).');
  }
  if (!hasCameraApi()) {
    throw new UnsupportedBrowserError('This browser does not support camera access.');
  }
  if (!hasCanvasApi()) {
    throw new UnsupportedBrowserError('This browser does not support canvas rendering.');
  }
}

function toCameraError(error: unknown): Code39ScannerError {
  const name = (error as { name?: unknown } | null)?.name;
  const [ErrorClass, message] =
    (typeof name === 'string' && MEDIA_ERRORS.get(name)) || UNKNOWN_MEDIA_ERROR;
  return new ErrorClass(message, { cause: error });
}

const cancelledStart = (cause?: unknown) =>
  new OperationCancelledError('Camera start was superseded by a later start() or stop() call.', {
    cause,
  });

const stopStream = (stream: MediaStream | null): void =>
  stream?.getTracks().forEach((track) => track.stop());

function videoConstraints(deviceId: string | undefined): MediaTrackConstraints {
  return {
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: PREFERRED_FACING_MODE } }),
    width: { ideal: IDEAL_RESOLUTION.width },
    height: { ideal: IDEAL_RESOLUTION.height },
  };
}

function createContext2D(): Context2D | null {
  const settings: CanvasRenderingContext2DSettings = { willReadFrequently: true };
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1).getContext('2d', settings);
  }
  return document.createElement('canvas').getContext('2d', settings);
}

/** Reads single rows/columns back from the canvas instead of copying the whole frame. */
function luminanceFromContext(context: Context2D, width: number, height: number): LuminanceSource {
  return {
    width,
    height,
    row: (y) => lumaLine(context.getImageData(0, y, width, 1).data, width),
    column: (x) => lumaLine(context.getImageData(x, 0, 1, height).data, height),
  };
}

/** Camera-backed `FrameSource` using `getUserMedia`, rendering the preview into a `<video>`. */
export class CameraFrameSource implements FrameSource {
  /** Whether the browser offers everything camera scanning needs (camera and 2D canvas). */
  static isSupported(): boolean {
    return hasCameraApi() && hasCanvasApi();
  }

  /**
   * Lists video input devices. Browsers reveal device ids and labels only after camera
   * permission has been granted, so call this after `start()` for a complete list.
   */
  static async listCameras(): Promise<CameraDevice[]> {
    assertCameraAccess();
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId !== '')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  }

  readonly #video: HTMLVideoElement;
  readonly #maxFrameSize: number;
  #stream: MediaStream | null = null;
  #context: Context2D | null = null;
  /** Incremented by every `stop()`; a `start()` that observes a change was superseded. */
  #generation = 0;

  constructor(video: HTMLVideoElement, options: CameraFrameSourceOptions = {}) {
    if (typeof video?.play !== 'function') {
      throw new InvalidOptionsError('"video" must be an HTMLVideoElement.');
    }
    this.#video = video;
    this.#maxFrameSize = validateNumberOption(
      'maxFrameSize',
      options.maxFrameSize ?? DEFAULT_SCANNER_OPTIONS.maxFrameSize,
    );
  }

  get isActive(): boolean {
    return this.#stream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
  }

  get activeDeviceId(): string | undefined {
    return this.#stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  /**
   * Opens the camera. Everything frames need (the 2D canvas) is verified first, so the camera is
   * never switched on in a browser that cannot scan. Safe to call concurrently: a call superseded
   * by a later `start()` or `stop()` releases what it acquired and rejects with
   * `OperationCancelledError`.
   */
  async start({ deviceId }: StartOptions = {}): Promise<void> {
    assertCameraAccess();
    this.#getContext();
    this.stop();
    const generation = this.#generation;
    const isSuperseded = () => generation !== this.#generation;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints(deviceId),
      });
    } catch (error) {
      throw isSuperseded() ? cancelledStart(error) : toCameraError(error);
    }
    if (isSuperseded()) {
      stopStream(stream);
      throw cancelledStart();
    }

    this.#stream = stream;
    const video = this.#video;
    // Required for inline autoplay on iOS Safari.
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      if (isSuperseded()) throw cancelledStart(error);
      this.stop();
      throw new CameraUnavailableError('Unable to play the camera stream.', { cause: error });
    }
    if (isSuperseded()) throw cancelledStart();
  }

  stop(): void {
    this.#generation++;
    stopStream(this.#stream);
    this.#stream = null;
    if (this.#video.srcObject) this.#video.srcObject = null;
  }

  /** Draws the current frame once; scanlines are read back lazily by the decoder. */
  grabFrame(): LuminanceSource | null {
    const video = this.#video;
    const { videoWidth, videoHeight } = video;
    if (!this.#stream || video.readyState < HAVE_CURRENT_DATA || !videoWidth || !videoHeight) {
      return null;
    }
    const scale = Math.min(1, this.#maxFrameSize / Math.max(videoWidth, videoHeight));
    const width = Math.round(videoWidth * scale);
    const height = Math.round(videoHeight * scale);

    const context = this.#getContext();
    if (context.canvas.width !== width || context.canvas.height !== height) {
      context.canvas.width = width;
      context.canvas.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    return luminanceFromContext(context, width, height);
  }

  /** The reusable canvas context (offscreen when available), created on first use. */
  #getContext(): Context2D {
    this.#context ??= createContext2D();
    if (!this.#context) throw new UnsupportedBrowserError('Canvas 2D rendering is not available.');
    return this.#context;
  }
}
