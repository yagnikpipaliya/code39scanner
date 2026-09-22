/**
 * Camera plumbing for the demo page: opens the camera, draws each frame onto a canvas once and
 * feeds scanlines to the Code 39 decoder in src/code39-scanner.js.
 *
 * @typedef {{ deviceId: string, label: string }} CameraDevice
 * @typedef {{ text: string, timestamp: number }} ScanResult
 * @typedef {typeof ScannerState[keyof typeof ScannerState]} ScannerStateValue
 */
import { decodeRuns, toRuns } from '../src/code39-scanner.js';

/** Scanlines sampled per direction, per frame. */
const SCAN_LINES = 24;
/** Longest side of a frame after downscaling, in pixels. */
const MAX_FRAME_SIZE = 1280;
/** Minimum time between two decoded frames, in milliseconds. */
const SCAN_INTERVAL_MS = 100;
/** How long a barcode must be out of view before it is reported again. */
const PRESENCE_MS = 1500;
/** Distance to the confirming scanline, in narrow-bar widths of the symbol. */
const CONFIRM_SPACING_MODULES = 3;
/** `HTMLMediaElement.HAVE_CURRENT_DATA`, without touching the DOM global at import time. */
const HAVE_CURRENT_DATA = 2;

export const ScannerState = Object.freeze({
  Idle: 'idle',
  Starting: 'starting',
  Scanning: 'scanning',
});

/**
 * One row or column of the canvas, decoded. Reading back single lines beats copying the frame.
 *
 * @param {CanvasRenderingContext2D} context
 * @param {boolean} across Whether to read a horizontal row rather than a vertical column.
 * @param {number} at Row or column index.
 * @param {number} width
 * @param {number} height
 * @returns {{ text: string, moduleWidth: number }[]}
 */
function decodeLine(context, across, at, width, height) {
  const { data } = across
    ? context.getImageData(0, at, width, 1)
    : context.getImageData(at, 0, 1, height);
  const samples = new Uint8Array(data.length / 4);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  }
  const runs = toRuns(samples);
  return runs ? decodeRuns(runs) : [];
}

/** Live Code 39 scanning from the device camera, previewed in a `<video>` element. */
export class Code39Scanner {
  /**
   * @param {object} options
   * @param {HTMLVideoElement} options.video Preview element the camera stream is played in.
   * @param {(result: ScanResult) => void} options.onDetect
   * @param {(state: ScannerStateValue) => void} [options.onChange]
   * @param {(error: unknown) => void} [options.onError]
   */
  constructor({ video, onDetect, onChange = () => {}, onError = () => {} }) {
    Object.assign(this, { video, onDetect, onChange, onError });
    this.state = ScannerState.Idle;
    this.stream = null;
    this.context = null;
    this.timer = null;
    /** Last time each value was seen, so one label in view is not reported every frame. */
    this.seen = new Map();
    /** Incremented by every start and stop; a call that sees a change was superseded. */
    this.run = 0;
  }

  /** @returns {boolean} Whether this browser offers camera access at all. */
  static isSupported() {
    return typeof navigator?.mediaDevices?.getUserMedia === 'function';
  }

  /**
   * Lists video inputs. Browsers reveal ids and labels only once permission has been granted,
   * so call this after `start()` for a complete list.
   *
   * @returns {Promise<CameraDevice[]>}
   */
  static async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput' && device.deviceId)
      .map((device, i) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${i + 1}`,
      }));
  }

  /** @returns {string | undefined} The camera currently streaming. */
  get deviceId() {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  /**
   * Opens the camera and starts scanning. Failures are reported through `onError` rather than
   * thrown, and a start replaced by a later `start()` or `stop()` releases whatever it acquired
   * and gives up quietly.
   *
   * @param {string} [deviceId]
   * @returns {Promise<void>}
   */
  async start(deviceId) {
    this.stop();
    const run = ++this.run;
    this.#setState(ScannerState.Starting);
    const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video });
      if (run !== this.run) return stream.getTracks().forEach((track) => track.stop());
      this.stream = stream;
      this.video.srcObject = stream;
      // Required for inline autoplay on iOS Safari.
      this.video.playsInline = true;
      this.video.muted = true;
      await this.video.play();
      if (run !== this.run) return;
      this.timer = setInterval(() => this.#tick(), SCAN_INTERVAL_MS);
      this.#setState(ScannerState.Scanning);
    } catch (error) {
      if (run !== this.run) return;
      this.stop();
      this.onError(error);
    }
  }

  /** Releases the camera and cancels any start still waiting for permission. */
  stop() {
    this.run++;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video.srcObject) this.video.srcObject = null;
    this.stream = null;
    this.timer = null;
    this.seen.clear();
    this.#setState(ScannerState.Idle);
  }

  /** @param {ScannerStateValue} state */
  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onChange(state);
  }

  /** One scan, with any failure treated as unrecoverable so the loop cannot spin on it. */
  #tick() {
    try {
      this.scanFrame();
    } catch (error) {
      this.stop();
      this.onError(error);
    }
  }

  /**
   * One frame: drawn once, then scanned horizontally and vertically. A value is reported only
   * when a second scanline a few modules away agrees on it, so a pattern that appears on a
   * single pixel row — sensor noise, a stroke of printed text — is never reported.
   */
  scanFrame() {
    const { videoWidth, videoHeight, readyState } = this.video;
    if (readyState < HAVE_CURRENT_DATA || !videoWidth || !videoHeight) return;
    const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(videoWidth, videoHeight));
    const width = Math.round(videoWidth * scale);
    const height = Math.round(videoHeight * scale);
    this.context ??= /** @type {CanvasRenderingContext2D} */ (
      document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    );
    const { canvas } = this.context;
    if (canvas.width !== width || canvas.height !== height) {
      Object.assign(canvas, { width, height });
    }
    this.context.drawImage(this.video, 0, 0, width, height);

    for (const across of [true, false]) {
      const length = across ? height : width;
      const line = (at) => decodeLine(this.context, across, at, width, height);
      for (let i = 1; i <= SCAN_LINES; i++) {
        const at = Math.floor((i * length) / (SCAN_LINES + 1));
        for (const { text, moduleWidth } of line(at)) {
          const step = Math.max(1, Math.round(CONFIRM_SPACING_MODULES * moduleWidth));
          const probes = [at - step, at + step].filter((probe) => probe >= 0 && probe < length);
          if (probes.some((probe) => line(probe).some((other) => other.text === text))) {
            this.#report(text);
          }
        }
      }
    }
  }

  /** @param {string} text */
  #report(text) {
    const now = Date.now();
    const last = this.seen.get(text);
    if (last === undefined || now - last >= PRESENCE_MS) this.onDetect({ text, timestamp: now });
    this.seen.set(text, now);
  }
}
