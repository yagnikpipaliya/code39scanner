import { CameraUnavailableError, InvalidOptionsError } from '../errors.js';
import { TypedEventEmitter, type Listener } from '../events.js';
import { Code39ImageDecoder } from '../image/image-decoder.js';
import { resolveScannerOptions, type ScannerOptions } from '../options.js';
import type { ScanResult } from '../types.js';
import { CameraFrameSource, type CameraDevice } from './camera-frame-source.js';
import type { FrameSource, StartOptions } from './frame-source.js';
import { PresenceTracker } from './presence-tracker.js';

export type ScannerState = 'idle' | 'starting' | 'scanning';

export interface ScannerEventMap {
  /** A barcode came into view. */
  detect: ScanResult;
  /** A runtime failure while scanning (e.g. the camera was disconnected). */
  error: Error;
  statechange: ScannerState;
}

export interface Code39ScannerOptions extends ScannerOptions {
  /** Element that shows the camera preview. Required unless `frameSource` is given. */
  readonly video?: HTMLVideoElement;
  /** Custom frame provider; replaces the built-in camera source. */
  readonly frameSource?: FrameSource;
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const isDocumentHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Live Code 39 scanner: pulls frames from a `FrameSource`, decodes them and emits `detect`
 * once per barcode appearance.
 *
 * Lifecycle calls (`start`, `switchCamera`, `stop`, `dispose`) are serialized, so rapid or
 * overlapping calls (e.g. double clicks) cannot leave the camera in an inconsistent state.
 */
export class Code39Scanner {
  static isSupported(): boolean {
    return CameraFrameSource.isSupported();
  }

  static listCameras(): Promise<CameraDevice[]> {
    return CameraFrameSource.listCameras();
  }

  readonly #events = new TypedEventEmitter<ScannerEventMap>();
  readonly #source: FrameSource;
  readonly #decoder: Code39ImageDecoder;
  readonly #tracker: PresenceTracker;
  readonly #scanIntervalMs: number;
  #state: ScannerState = 'idle';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: Code39ScannerOptions) {
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
    this.#tracker = new PresenceTracker(resolved.presenceTimeoutMs);
    this.#scanIntervalMs = resolved.scanIntervalMs;
  }

  get state(): ScannerState {
    return this.#state;
  }

  get activeDeviceId(): string | undefined {
    return this.#source.activeDeviceId;
  }

  on<K extends keyof ScannerEventMap>(type: K, listener: Listener<ScannerEventMap[K]>): () => void {
    return this.#events.on(type, listener);
  }

  off<K extends keyof ScannerEventMap>(type: K, listener: Listener<ScannerEventMap[K]>): void {
    this.#events.off(type, listener);
  }

  /**
   * Starts scanning. If already scanning, restarts only when a different `deviceId` is requested.
   * Rejects with a typed error (`PermissionDeniedError`, `CameraUnavailableError`, …).
   */
  start(options: StartOptions = {}): Promise<void> {
    return this.#serialize(async () => {
      const sameDevice =
        options.deviceId === undefined || options.deviceId === this.#source.activeDeviceId;
      if (this.#state === 'scanning' && sameDevice) return;

      this.#halt();
      this.#setState('starting');
      try {
        await this.#source.start(options);
      } catch (error) {
        this.#halt();
        throw error;
      }
      this.#setState('scanning');
      this.#scheduleTick(0);
    });
  }

  switchCamera(deviceId: string): Promise<void> {
    if (typeof deviceId !== 'string' || deviceId === '') {
      return Promise.reject(new InvalidOptionsError('"deviceId" must be a non-empty string.'));
    }
    return this.start({ deviceId });
  }

  stop(): Promise<void> {
    return this.#serialize(async () => this.#halt());
  }

  /** Stops scanning and removes all listeners. */
  async dispose(): Promise<void> {
    await this.stop();
    this.#events.clear();
  }

  #serialize(task: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #halt(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#source.stop();
    this.#tracker.reset();
    this.#setState('idle');
  }

  #setState(state: ScannerState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#events.emit('statechange', state);
  }

  #scheduleTick(delayMs: number): void {
    this.#timer = setTimeout(() => this.#tick(), delayMs);
  }

  #tick(): void {
    this.#timer = undefined;
    if (this.#state !== 'scanning') return;

    if (!this.#source.isActive) {
      this.#halt();
      this.#reportError(new CameraUnavailableError('The camera stream ended unexpectedly.'));
      return;
    }

    const startedAt = Date.now();
    try {
      this.#scanFrame();
    } catch (error) {
      this.#reportError(toError(error));
    }
    // A listener may have stopped the scanner during this tick.
    if (this.#state === 'scanning' && this.#timer === undefined) {
      this.#scheduleTick(Math.max(0, this.#scanIntervalMs - (Date.now() - startedAt)));
    }
  }

  #scanFrame(): void {
    if (isDocumentHidden()) return;
    const frame = this.#source.grabFrame();
    if (!frame) return;

    const results = this.#decoder.decodeAll(frame);
    const appeared = new Set(this.#tracker.observe(results.map((result) => result.rawText)));
    const timestamp = Date.now();
    for (const result of results) {
      if (appeared.has(result.rawText)) this.#events.emit('detect', { ...result, timestamp });
    }
  }

  #reportError(error: Error): void {
    if (this.#events.emit('error', error)) return;
    // Never swallow errors silently when nobody listens.
    if (typeof reportError === 'function') reportError(error);
    else console.error(error);
  }
}
