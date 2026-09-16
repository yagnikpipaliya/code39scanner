import {
  CameraUnavailableError,
  InsecureContextError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from '../errors.js';
import { lumaLine } from '../image/luminance.js';
import { DEFAULT_SCANNER_OPTIONS, validateNumberOption } from '../options.js';

export const CameraDevice = Object.freeze({});

export const CameraFrameSourceOptions = Object.freeze({});

/** `HTMLMediaElement.HAVE_CURRENT_DATA` without touching the DOM global at import time. */
const HAVE_CURRENT_DATA = 2;
const PREFERRED_FACING_MODE = 'environment';
const IDEAL_RESOLUTION = { width: 1920, height: 1080 };

const CAMERA_BUSY_MESSAGE = 'The camera is in use by another application or could not be started.';
const NO_CAMERA_MESSAGE = 'No matching camera was found.';
const PERMISSION_MESSAGE = 'Camera permission was denied.';

/** `getUserMedia` DOMException name → typed error. */
const MEDIA_ERRORS = new Map([
  ['NotAllowedError', [PermissionDeniedError, PERMISSION_MESSAGE]],
  ['SecurityError', [PermissionDeniedError, PERMISSION_MESSAGE]],
  ['NotFoundError', [CameraUnavailableError, NO_CAMERA_MESSAGE]],
  ['OverconstrainedError', [CameraUnavailableError, NO_CAMERA_MESSAGE]],
  ['NotReadableError', [CameraUnavailableError, CAMERA_BUSY_MESSAGE]],
  ['AbortError', [CameraUnavailableError, CAMERA_BUSY_MESSAGE]],
]);
const UNKNOWN_MEDIA_ERROR = [CameraUnavailableError, 'Unable to access the camera.'];

const hasCameraApi = () =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * Creates a 2D context, preferring an offscreen canvas and falling back to a regular `<canvas>`
 * when `OffscreenCanvas` is missing or cannot provide a 2D context. `null` if neither can.
 */
function createContext2D() {
  const settings = { willReadFrequently: true };
  const offscreen =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1).getContext('2d', settings)
      : null;
  if (offscreen) return offscreen;
  return typeof document !== 'undefined'
    ? document.createElement('canvas').getContext('2d', settings)
    : null;
}

/** Secure context and camera API. Canvas support is verified by creating the real context. */
function assertCameraAccess() {
  // Checked first: insecure contexts hide `navigator.mediaDevices` entirely.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new InsecureContextError('Camera access requires a secure context (HTTPS or localhost).');
  }
  if (!hasCameraApi()) {
    throw new UnsupportedBrowserError('This browser does not support camera access.');
  }
}

function toCameraError(error) {
  const name = error?.name;
  const [ErrorClass, message] =
    (typeof name === 'string' && MEDIA_ERRORS.get(name)) || UNKNOWN_MEDIA_ERROR;
  return new ErrorClass(message, { cause: error });
}

const cancelledStart = (cause) =>
  OperationCancelledError.superseded('Camera start', cause);

const stopStream = (stream) =>
  stream?.getTracks().forEach((track) => track.stop());

function videoConstraints(deviceId) {
  return {
    ...(deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: PREFERRED_FACING_MODE } }),
    width: { ideal: IDEAL_RESOLUTION.width },
    height: { ideal: IDEAL_RESOLUTION.height },
  };
}

/** Reads single rows/columns back from the canvas instead of copying the whole frame. */
function luminanceFromContext(context, width, height) {
  return {
    width,
    height,
    row: (y) => lumaLine(context.getImageData(0, y, width, 1).data, width),
    column: (x) => lumaLine(context.getImageData(x, 0, 1, height).data, height),
  };
}

/** Camera-backed `FrameSource` using `getUserMedia`, rendering the preview into a `<video>`. */
export class CameraFrameSource {
  #video;
  #maxFrameSize;
  #stream;
  #context;
  #generation;
  /**
   * Whether the browser offers everything camera scanning needs: the camera API and a working
   * 2D canvas context (probed by creating a 1×1 canvas).
   */
  static isSupported() {
    return hasCameraApi() && createContext2D() !== null;
  }

  /**
   * Lists video input devices. Browsers reveal device ids and labels only after camera
   * permission has been granted, so call this after `start()` for a complete list.
   */
  static async listCameras() {
    assertCameraAccess();
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId !== '')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      }));
  }

  constructor(video, options = {}) {
    if (typeof video?.play !== 'function') {
      throw new InvalidOptionsError('"video" must be an HTMLVideoElement.');
    }
    this.#video = video;
    this.#maxFrameSize = validateNumberOption(
      'maxFrameSize',
      options.maxFrameSize ?? DEFAULT_SCANNER_OPTIONS.maxFrameSize,
    );
    this.#stream = null;
    this.#context = null;
    /** Incremented by every `stop()`; a `start()` that observes a change was superseded. */
    this.#generation = 0;
  }

  get isActive() {
    return this.#stream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
  }

  get activeDeviceId() {
    return this.#stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  /**
   * Opens the camera. The canvas context frames need is created first, so the camera is never
   * switched on in a browser that cannot scan. Safe to call concurrently: a call superseded by a
   * later `start()` or `stop()` releases what it acquired and rejects with
   * `OperationCancelledError`.
   */
  async start({ deviceId } = {}) {
    assertCameraAccess();
    this.#getContext();
    this.stop();
    const generation = this.#generation;
    const isSuperseded = () => generation !== this.#generation;

    let stream;
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

  stop() {
    this.#generation++;
    stopStream(this.#stream);
    this.#stream = null;
    if (this.#video.srcObject) this.#video.srcObject = null;
  }

  /** Draws the current frame once; scanlines are read back lazily by the decoder. */
  grabFrame() {
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

  /** The reusable canvas context, created on first use. */
  #getContext() {
    this.#context ??= createContext2D();
    if (!this.#context) throw new UnsupportedBrowserError('Canvas 2D rendering is not available.');
    return this.#context;
  }
}