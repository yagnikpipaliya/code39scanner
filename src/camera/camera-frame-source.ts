import {
  CameraUnavailableError,
  InsecureContextError,
  InvalidOptionsError,
  PermissionDeniedError,
  UnsupportedBrowserError,
  type Code39ScannerError,
} from '../errors.js';
import { DEFAULT_SCANNER_OPTIONS } from '../options.js';
import type { RgbaImage } from '../types.js';
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

/** `HTMLMediaElement.HAVE_CURRENT_DATA` without touching the DOM global at import time. */
const HAVE_CURRENT_DATA = 2;

function assertCameraAccess(): void {
  // Checked first: insecure contexts hide `navigator.mediaDevices` entirely.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new InsecureContextError('Camera access requires a secure context (HTTPS or localhost).');
  }
  if (!CameraFrameSource.isSupported()) {
    throw new UnsupportedBrowserError('This browser does not support camera access.');
  }
}

function toCameraError(error: unknown): Code39ScannerError {
  const name = (error as { name?: unknown } | null)?.name;
  const options = { cause: error };
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new PermissionDeniedError('Camera permission was denied.', options);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraUnavailableError('No matching camera was found.', options);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraUnavailableError(
        'The camera is in use by another application or could not be started.',
        options,
      );
    default:
      return new CameraUnavailableError('Unable to access the camera.', options);
  }
}

/** Camera-backed `FrameSource` using `getUserMedia`, rendering the preview into a `<video>`. */
export class CameraFrameSource implements FrameSource {
  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    );
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

  constructor(video: HTMLVideoElement, options: CameraFrameSourceOptions = {}) {
    if (typeof video?.play !== 'function') {
      throw new InvalidOptionsError('"video" must be an HTMLVideoElement.');
    }
    this.#video = video;
    this.#maxFrameSize = options.maxFrameSize ?? DEFAULT_SCANNER_OPTIONS.maxFrameSize;
  }

  get isActive(): boolean {
    return this.#stream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
  }

  get activeDeviceId(): string | undefined {
    return this.#stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  async start({ deviceId }: StartOptions = {}): Promise<void> {
    assertCameraAccess();
    this.stop();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (error) {
      throw toCameraError(error);
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
      this.stop();
      throw new CameraUnavailableError('Unable to play the camera stream.', { cause: error });
    }
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    if (this.#video.srcObject) this.#video.srcObject = null;
  }

  grabFrame(): RgbaImage | null {
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
    return context.getImageData(0, 0, width, height);
  }

  /** Lazily creates one reusable canvas (offscreen when available). */
  #getContext(): Context2D {
    this.#context ??= createContext2D();
    if (!this.#context) throw new UnsupportedBrowserError('Canvas 2D rendering is not available.');
    return this.#context;
  }
}

function createContext2D(): Context2D | null {
  const settings: CanvasRenderingContext2DSettings = { willReadFrequently: true };
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(1, 1).getContext('2d', settings);
  }
  return document.createElement('canvas').getContext('2d', settings);
}
