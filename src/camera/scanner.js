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

/**
 * @typedef {import('../types.js').FrameSource} FrameSource
 * @typedef {import('../types.js').ScanResult} ScanResult
 * @typedef {import('../types.js').StartOptions} StartOptions
 * @typedef {import('./camera-frame-source.js').CameraDevice} CameraDevice
 */

export const ScannerState = defineEnum({
  Idle: 'idle',
  Starting: 'starting',
  Scanning: 'scanning',
});
/** @typedef {import('../utils.js').EnumValue<typeof ScannerState>} ScannerStateValue */

export const ScannerEvent = defineEnum({
  /** A barcode came into view. */
  Detect: 'detect',
  /** A failure while scanning (e.g. the camera was disconnected). */
  Error: 'error',
  StateChange: 'statechange',
});

/**
 * Payload of each event: `detect` → {@link ScanResult}, `error` → `Code39ScannerError`,
 * `statechange` → a {@link ScannerState} value.
 * @typedef {{
 *   detect: ScanResult,
 *   error: Code39ScannerError,
 *   statechange: ScannerStateValue,
 * }} ScannerEventMap
 */

/**
 * Scanner options plus
 * - `video`: element that shows the camera preview. Required unless `frameSource` is given.
 * - `frameSource`: custom frame provider; replaces the built-in camera source.
 * @typedef {import('../options.js').ScannerOptions & {
 *   video?: HTMLVideoElement,
 *   frameSource?: FrameSource,
 * }} Code39ScannerOptions
 */

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

/**
 * Every emitted error is a package error with a stable `code`; the original is kept as `cause`.
 * @param {unknown} error
 * @returns {Code39ScannerError}
 */
const toScannerError = (error) =>
  error instanceof Code39ScannerError
    ? error
    : new FrameProcessingError('Failed to process a camera frame.', { cause: error });

/** @param {unknown} [cause] */
const cancelledStart = (cause) => OperationCancelledError.superseded('Scanner start', cause);

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
  /**
   * Whether the browser offers everything camera scanning needs.
   * @returns {boolean}
   */
  static isSupported() {
    return CameraFrameSource.isSupported();
  }

  /** @returns {Promise<CameraDevice[]>} */
  static listCameras() {
    return CameraFrameSource.listCameras();
  }

  #events = new TypedEventEmitter();
  /** @type {FrameSource} */
  #source;
  /** @type {Code39ImageDecoder} */
  #decoder;
  /** @type {PresenceTracker} */
  #tracker;
  /** @type {number} */
  #scanIntervalMs;
  /** @type {ScannerStateValue} */
  #state = ScannerState.Idle;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #timer;
  /** @type {Promise<unknown>} */
  #queue = Promise.resolve();
  /** Incremented by `stop()`; a `start()` that observes a change was cancelled. */
  #generation = 0;
  #linePhase = INITIAL_LINE_PHASE;
  #consecutiveFailures = 0;

  /** @param {Code39ScannerOptions} options */
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
  }

  /** @returns {ScannerStateValue} */
  get state() {
    return this.#state;
  }

  /** @returns {string | undefined} */
  get activeDeviceId() {
    return this.#source.activeDeviceId;
  }

  /**
   * Subscribes to a {@link ScannerEvent}. Returns an unsubscribe function.
   * @template {keyof ScannerEventMap} K
   * @param {K} type
   * @param {(payload: ScannerEventMap[K]) => void} listener
   * @returns {() => void}
   */
  on(type, listener) {
    return this.#events.on(type, listener);
  }

  /**
   * @template {keyof ScannerEventMap} K
   * @param {K} type
   * @param {(payload: ScannerEventMap[K]) => void} listener
   */
  off(type, listener) {
    this.#events.off(type, listener);
  }

  /**
   * Starts scanning. If already scanning, restarts only when a different `deviceId` is requested.
   * Rejects with a typed error (`PermissionDeniedError`, `CameraUnavailableError`, …), or with
   * `OperationCancelledError` if `stop()`/`dispose()` is called before it completes.
   * @param {StartOptions} [options]
   * @returns {Promise<void>}
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

  /**
   * @param {string} deviceId
   * @returns {Promise<void>}
   */
  switchCamera(deviceId) {
    if (typeof deviceId !== 'string' || deviceId === '') {
      return Promise.reject(new InvalidArgumentError('"deviceId" must be a non-empty string.'));
    }
    return this.start({ deviceId });
  }

  /**
   * Stops scanning and releases the camera. Takes effect immediately, including on a pending
   * `start()`: the state becomes idle at once, and the pending call rejects with
   * `OperationCancelledError` when it settles, without ever resuming scanning.
   * @returns {Promise<void>}
   */
  stop() {
    // Invalidates every pending or queued start(); each checks the generation before scanning.
    this.#generation++;
    // Not queued behind a pending start(), which may wait indefinitely (e.g. on a permission
    // prompt). Releasing the source also cancels its in-flight camera request: a prompt that is
    // already open cannot be closed by the page, but a stream it grants later is released at once.
    this.#halt();
    return Promise.resolve();
  }

  /**
   * Stops scanning, then detaches all listeners. Listeners receive the final
   * `StateChange → idle`; no `Detect` can follow, because `stop()` cancels a pending start
   * synchronously.
   * @returns {Promise<void>}
   */
  async dispose() {
    try {
      await this.stop();
    } finally {
      this.#events.clear();
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
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

  /**
   * Stops scanning because of an unrecoverable error, then reports it.
   * @param {Code39ScannerError} error
   */
  #fail(error) {
    this.#halt();
    this.#reportError(error);
  }

  /** @param {ScannerStateValue} state */
  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.#events.emit(ScannerEvent.StateChange, state);
  }

  /** @param {number} delayMs */
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

  /**
   * Decodes the current frame and emits detections. Returns whether a frame was processed.
   * @returns {boolean}
   */
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

  /** @param {Code39ScannerError} error */
  #reportError(error) {
    if (this.#events.emit(ScannerEvent.Error, error)) return;
    // Never swallow errors silently when nobody listens.
    if (typeof reportError === 'function') reportError(error);
    else console.error(error);
  }
}
