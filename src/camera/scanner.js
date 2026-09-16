import {
  CameraUnavailableError,
  Code39ScannerError,
  ErrorCode,
  FrameProcessingError,
  InvalidArgumentError,
  InvalidOptionsError,
  OperationCancelledError,
} from '../errors.js';
import { TypedEventEmitter } from '../events.js';
import { Code39ImageDecoder } from '../image/image-decoder.js';
import { resolveScannerOptions } from '../options.js';
import { defineEnum, monotonicClock } from '../utils.js';
import { CameraFrameSource } from './camera-frame-source.js';
import { PresenceTracker } from './presence-tracker.js';

export const ScannerState = defineEnum({
  Idle: 'idle',
  Starting: 'starting',
  Scanning: 'scanning',
});

export const ScannerEvent = defineEnum({
  /** A barcode came into view. */
  Detect: 'detect',
  /** A failure while scanning (e.g. the camera was disconnected). */
  Error: 'error',
  StateChange: 'statechange',
});

/** @typedef {{ [ScannerEvent.Detect]: ScanResult, [ScannerEvent.Error]: Code39ScannerError, [ScannerEvent.StateChange]: ScannerState }} ScannerEventMap */

/** @typedef {ScannerOptions & { readonly video?: HTMLVideoElement, readonly frameSource?: FrameSource }} Code39ScannerOptions */

/**
 * Step between the scanline phases of successive frames. The golden-ratio sequence never
 * repeats and spreads evenly, so the sampled lines sweep the whole frame within a few frames.
 */
const LINE_PHASE_STEP = (Math.sqrt(5) - 1) / 2;
const INITIAL_LINE_PHASE = 0.5;

/**
 * Consecutive failed frames tolerated before scanning stops; isolated glitches recover. Only
 * processed frames count: ticks without a frame (hidden page, camera not ready) neither fail nor
 * reset the count.
 */
const MAX_CONSECUTIVE_FRAME_FAILURES = 5;
/**
 * Errors that retrying the next frame cannot fix: missing browser support, a lost camera, or a
 * frame source producing invalid frames.
 */
const FATAL_ERROR_CODES = new Set([
  ErrorCode.UnsupportedBrowser,
  ErrorCode.InsecureContext,
  ErrorCode.PermissionDenied,
  ErrorCode.CameraUnavailable,
  ErrorCode.InvalidArgument,
  ErrorCode.InvalidOptions,
]);

/** Every emitted error is a package error with a stable `code`; the original is kept as `cause`. */
const toScannerError = (error) =>
  error instanceof Code39ScannerError
    ? error
    : new FrameProcessingError('Failed to process a camera frame.', { cause: error });

const cancelledStart = (cause) =>
  OperationCancelledError.superseded('Scanner start', cause);

const isDocumentHidden = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Live Code 39 scanner: pulls frames from a `FrameSource`, decodes them and emits `detect`
 * once per barcode appearance, after the barcode has been confirmed in `minFrameConfirmations`
 * frames.
 *
 * Lifecycle calls are serialized, so rapid or overlapping calls (e.g. double clicks) cannot
 * leave the camera in an inconsistent state. `stop()` and `dispose()` additionally take effect
 * immediately: a `start()` that is still pending (e.g. on a permission prompt) is cancelled, and
 * whatever it acquires later is released at once.
 */
export class Code39Scanner {
  /** Whether the browser offers everything camera scanning needs. */
  static isSupported() {
    return CameraFrameSource.isSupported();
  }

  static listCameras() {
    return CameraFrameSource.listCameras();
  }

  #source;
  #decoder;
  #tracker;
  #scanIntervalMs;
  #events;
  #state;
  #timer;
  #queue;
  #generation;
  #linePhase;
  #consecutiveFailures;

  constructor(options) {
    const { video, frameSource, ...scannerOptions } = options ?? {};
    const resolved = resolveScannerOptions(scannerOptions);
    if (frameSource) {
      this.#source = frameSource;
    } else if (video) {
      this.#source = new CameraFrameSource(video, { maxFrameSize: resolved.maxFrameSize });
    } else {
      throw new InvalidOptionsError('Either "video" or "frameSource" must be provided.');
    }
    this.#decoder = new Code39ImageDecoder(resolved);
    this.#tracker = new PresenceTracker(
      resolved.presenceTimeoutMs,
      monotonicClock,
      resolved.minFrameConfirmations,
    );
    this.#scanIntervalMs = resolved.scanIntervalMs;
    this.#events = new TypedEventEmitter();
    this.#state = ScannerState.Idle;
    this.#timer = undefined;
    this.#queue = Promise.resolve();
    /** Incremented by `stop()`; a `start()` that observes a change was cancelled. */
    this.#generation = 0;
    this.#linePhase = INITIAL_LINE_PHASE;
    this.#consecutiveFailures = 0;
  }

  get state() {
    return this.#state;
  }

  get activeDeviceId() {
    return this.#source.activeDeviceId;
  }

  /** @param {keyof ScannerEventMap} type */
  on(type, listener) {
    return this.#events.on(type, listener);
  }

  /** @param {keyof ScannerEventMap} type */
  off(type, listener) {
    this.#events.off(type, listener);
  }

  /**
   * Starts scanning. If already scanning, restarts only when a different `deviceId` is requested.
   * Rejects with a typed error (`PermissionDeniedError`, `CameraUnavailableError`, …), or with
   * `OperationCancelledError` if `stop()`/`dispose()` is called before it completes.
   */
  start(options = {}) {
    const generation = this.#generation;
    return this.#serialize(async () => {
      if (generation !== this.#generation) throw cancelledStart();
      const sameDevice =
        options.deviceId === undefined || options.deviceId === this.#source.activeDeviceId;
      if (this.#state === ScannerState.Scanning && sameDevice) return;

      // A restart (e.g. switching cameras) goes straight to "starting", never through "idle".
      this.#cancelTick();
      this.#source.stop();
      this.#setState(ScannerState.Starting);
      try {
        await this.#source.start(options);
        if (generation !== this.#generation) throw cancelledStart();
      } catch (error) {
        this.#halt();
        const superseded = generation !== this.#generation;
        throw superseded && !(error instanceof OperationCancelledError)
          ? cancelledStart(error)
          : error;
      }
      this.#tracker.reset();
      this.#consecutiveFailures = 0;
      this.#setState(ScannerState.Scanning);
      this.#scheduleTick(0);
    });
  }

  switchCamera(deviceId) {
    if (typeof deviceId !== 'string' || deviceId === '') {
      return Promise.reject(new InvalidArgumentError('"deviceId" must be a non-empty string.'));
    }
    return this.start({ deviceId });
  }

  /**
   * Stops scanning and releases the camera. Takes effect immediately, including on a pending
   * `start()` (which then rejects with `OperationCancelledError`).
   */
  stop() {
    this.#generation++;
    this.#cancelTick();
    // Releasing the source invalidates an in-flight camera request. A permission prompt that is
    // already open cannot be closed by the page, but a stream it grants later is released at once.
    this.#source.stop();
    return this.#serialize(async () => this.#halt());
  }

  /**
   * Stops scanning, then detaches all listeners. Listeners receive the final
   * `StateChange → idle`; no `Detect` can follow, because `stop()` cancels a pending start
   * synchronously.
   */
  async dispose() {
    try {
      await this.stop();
    } finally {
      this.#events.clear();
    }
  }

  #serialize(task) {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #halt() {
    this.#cancelTick();
    this.#source.stop();
    this.#tracker.reset();
    this.#setState(ScannerState.Idle);
  }

  /** Stops scanning because of an unrecoverable error, then reports it. */
  #fail(error) {
    this.#halt();
    this.#reportError(error);
  }

  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.#events.emit(ScannerEvent.StateChange, state);
  }

  #scheduleTick(delayMs) {
    this.#timer = setTimeout(() => this.#tick(), delayMs);
  }

  #cancelTick() {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #tick() {
    this.#timer = undefined;
    if (this.#state !== ScannerState.Scanning) return;

    if (!this.#source.isActive) {
      this.#fail(new CameraUnavailableError('The camera stream ended unexpectedly.'));
      return;
    }

    const startedAt = monotonicClock();
    try {
      if (this.#scanFrame()) this.#consecutiveFailures = 0;
    } catch (thrown) {
      const error = toScannerError(thrown);
      this.#consecutiveFailures++;
      if (
        FATAL_ERROR_CODES.has(error.code) ||
        this.#consecutiveFailures >= MAX_CONSECUTIVE_FRAME_FAILURES
      ) {
        this.#fail(error);
        return;
      }
      this.#reportError(error);
    }
    // A listener may have stopped the scanner during this tick.
    if (this.#state === ScannerState.Scanning && this.#timer === undefined) {
      this.#scheduleTick(Math.max(0, this.#scanIntervalMs - (monotonicClock() - startedAt)));
    }
  }

  /** Decodes the current frame and emits detections. Returns whether a frame was processed. */
  #scanFrame() {
    if (isDocumentHidden()) return false;
    const frame = this.#source.grabFrame();
    if (!frame) return false;

    const linePhase = this.#linePhase;
    this.#linePhase = (linePhase + LINE_PHASE_STEP) % 1;
    const results = this.#decoder.decodeAll(frame, { linePhase });
    const appeared = new Set(this.#tracker.observe(results.map((result) => result.rawText)));
    const timestamp = Date.now();
    const generation = this.#generation;
    for (const result of results) {
      // A listener may have stopped or disposed the scanner; nothing is emitted after that.
      if (generation !== this.#generation) break;
      if (appeared.has(result.rawText)) {
        this.#events.emit(ScannerEvent.Detect, { ...result, timestamp });
      }
    }
    return true;
  }

  #reportError(error) {
    if (this.#events.emit(ScannerEvent.Error, error)) return;
    // Never swallow errors silently when nobody listens.
    if (typeof reportError === 'function') reportError(error);
    else console.error(error);
  }
}