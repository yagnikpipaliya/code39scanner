import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Code39Scanner, ScannerEvent, ScannerState } from '@/camera/scanner.js';
import {
  CameraUnavailableError,
  ErrorCode,
  FrameProcessingError,
  InvalidArgumentError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
  type Code39ScannerError,
} from '@/errors.js';
import { luminanceFromRgba } from '@/image/luminance.js';
import {
  BarcodeFormat,
  type FrameSource,
  type LuminanceSource,
  type RgbaImage,
  type ScanResult,
  type StartOptions,
} from '@/types.js';
import { composeImages, deferred, renderBarcode, type Deferred } from '@tests/helpers.js';

const BARCODE = renderBarcode('SCAN-1', { narrow: 2 });
const OTHER = renderBarcode('SCAN-2', { narrow: 2 });
/** 30px tall (rows 525–554 of 1080): between the default scanlines at their initial phase. */
const SHORT = renderBarcode('SMALL', { narrow: 2, height: 1080, barHeight: 30 / 1080 });
/**
 * 16px tall (rows 532–547 of 1080), far below the 45px scanline spacing: the moving scanlines
 * cross it only in some frames (the 2nd, 5th, 8th, …), never in two consecutive ones.
 */
const TINY = renderBarcode('TINY', { narrow: 2, height: 1080, barHeight: 17 / 1080 });
const LEFT = renderBarcode('LEFT', { narrow: 2, height: 80 });
const RIGHT = renderBarcode('RIGHT', { narrow: 2, height: 80 });
const TWO_BARCODES = composeImages(LEFT.width + RIGHT.width, 80, [
  { image: LEFT, x: 0, y: 0 },
  { image: RIGHT, x: LEFT.width, y: 0 },
]);
const BLANK: RgbaImage = {
  width: 100,
  height: 50,
  data: new Uint8ClampedArray(100 * 50 * 4).fill(230),
};
const EMPTY_FRAME: LuminanceSource = {
  width: 0,
  height: 0,
  row: () => new Uint8Array(0),
  column: () => new Uint8Array(0),
};

class FakeFrameSource implements FrameSource {
  frame: RgbaImage | null = null;
  isActive = false;
  activeDeviceId: string | undefined;
  startError: Error | null = null;
  /** When set, `start()` waits for it, like a pending camera permission prompt. */
  gate: Deferred<void> | null = null;
  /** Whether `stop()` aborts a pending `start()`, as `CameraFrameSource` does. */
  cancellable = true;
  readonly starts: StartOptions[] = [];
  grabs = 0;
  #pending = false;

  async start(options: StartOptions): Promise<void> {
    this.starts.push(options);
    if (this.gate) {
      this.#pending = true;
      try {
        await this.gate.promise;
      } finally {
        this.#pending = false;
      }
    }
    if (this.startError) throw this.startError;
    this.isActive = true;
    this.activeDeviceId = options.deviceId ?? 'default';
  }

  stop(): void {
    this.isActive = false;
    if (this.cancellable && this.#pending) {
      this.gate?.reject(new OperationCancelledError('Start aborted by stop().'));
    }
  }

  grabFrame(): LuminanceSource | null {
    this.grabs++;
    return this.frame && luminanceFromRgba(this.frame);
  }
}

function setup(options: { minFrameConfirmations?: number; presenceTimeoutMs?: number } = {}) {
  const source = new FakeFrameSource();
  const scanner = new Code39Scanner({ frameSource: source, scanIntervalMs: 100, ...options });
  const detections: ScanResult[] = [];
  const errors: Code39ScannerError[] = [];
  const states: ScannerState[] = [];
  scanner.on(ScannerEvent.Detect, (r) => detections.push(r));
  scanner.on(ScannerEvent.Error, (e) => errors.push(e));
  scanner.on(ScannerEvent.StateChange, (s) => states.push(s));
  return { source, scanner, detections, errors, states };
}

/** Settles a promise into its value or rejection reason, so rejections are never unhandled. */
const settle = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ value }),
    (reason: unknown) => ({ reason }),
  );

beforeEach(() => {
  // The scanner paces itself and tracks presence with the monotonic `performance.now()` clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Code39Scanner', () => {
  it('requires a video element or a frame source', () => {
    expect(() => new Code39Scanner({})).toThrow(InvalidOptionsError);
    expect(() => new Code39Scanner({ frameSource: new FakeFrameSource(), scanLines: 0 })).toThrow(
      InvalidOptionsError,
    );
  });

  it('starts, reports state changes and scans continuously', async () => {
    const { source, scanner, states } = setup();
    await scanner.start();
    expect(scanner.state).toBe(ScannerState.Scanning);
    expect(states).toEqual([ScannerState.Starting, ScannerState.Scanning]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.grabs).toBeGreaterThanOrEqual(10);
    expect(scanner.activeDeviceId).toBe('default');
  });

  it('emits one detection per appearance, on first sight by default', async () => {
    const { source, scanner, detections } = setup();
    const startTime = Date.parse('2026-01-01T00:00:00Z');
    vi.setSystemTime(startTime);
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ text: 'SCAN-1', format: BarcodeFormat.Code39 });
    expect(detections[0]!.timestamp).toBe(startTime);

    // Out of view longer than the presence timeout, then back in view → reported again.
    source.frame = BLANK;
    await vi.advanceTimersByTimeAsync(2000);
    source.frame = BARCODE;
    await vi.advanceTimersByTimeAsync(500);
    expect(detections.map((d) => d.text)).toEqual(['SCAN-1', 'SCAN-1']);
  });

  it('confirms across frames when minFrameConfirmations is 2', async () => {
    const { source, scanner, detections } = setup({ minFrameConfirmations: 2 });
    const startTime = Date.parse('2026-01-01T00:00:00Z');
    vi.setSystemTime(startTime);
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections).toHaveLength(1);
    // First seen at t = 0, confirmed by the second frame at t = 100 ms.
    expect(detections[0]!.timestamp).toBe(startTime + 100);
  });

  it('ignores a value decoded in a single frame when two are required', async () => {
    const { source, scanner, detections } = setup({ minFrameConfirmations: 2 });
    let frames = 0;
    vi.spyOn(source, 'grabFrame').mockImplementation(() =>
      frames++ === 0 ? luminanceFromRgba(BARCODE) : null,
    );
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections).toHaveLength(0);
  });

  it.each([1, 2])(
    'finds a tiny barcode crossed only in some frames (minFrameConfirmations %s)',
    async (minFrameConfirmations) => {
      const { source, scanner, detections } = setup({ minFrameConfirmations });
      source.frame = TINY;
      await scanner.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(detections.map((d) => d.text)).toEqual(['TINY']);
    },
  );

  it('keeps detecting with any presence timeout, even 0', async () => {
    const { source, scanner, detections } = setup({
      presenceTimeoutMs: 0,
      minFrameConfirmations: 2,
    });
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections.length).toBeGreaterThan(0);
  });

  it('does not re-emit across short detection gaps', async () => {
    const { source, scanner, detections } = setup();
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(300);
    source.frame = null;
    await vi.advanceTimersByTimeAsync(800);
    source.frame = BARCODE;
    await vi.advanceTimersByTimeAsync(300);
    expect(detections).toHaveLength(1);
  });

  it('reports a different barcode immediately', async () => {
    const { source, scanner, detections } = setup();
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(200);
    source.frame = OTHER;
    await vi.advanceTimersByTimeAsync(200);
    expect(detections.map((d) => d.text)).toEqual(['SCAN-1', 'SCAN-2']);
  });

  it('finds short barcodes by moving the scanlines between frames', async () => {
    const { source, scanner, detections } = setup();
    source.frame = SHORT;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections.map((d) => d.text)).toEqual(['SMALL']);
  });

  it('tolerates empty frames while the camera warms up', async () => {
    const { source, scanner, errors } = setup();
    vi.spyOn(source, 'grabFrame').mockReturnValue(EMPTY_FRAME);
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(0);
    expect(scanner.state).toBe(ScannerState.Scanning);
  });

  it('emits nothing more once a detect listener stops the scanner mid-frame', async () => {
    const { source, scanner, detections } = setup();
    source.frame = TWO_BARCODES;
    scanner.on(ScannerEvent.Detect, () => void scanner.stop());
    await scanner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(detections.map((d) => d.text)).toEqual(['LEFT']);
    expect(scanner.state).toBe(ScannerState.Idle);
  });

  it('stops scanning and releases the source', async () => {
    const { source, scanner, states } = setup();
    await scanner.start();
    await scanner.stop();
    const grabs = source.grabs;
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.grabs).toBe(grabs);
    expect(source.isActive).toBe(false);
    expect(states.at(-1)).toBe(ScannerState.Idle);
  });

  it('propagates start failures and returns to idle', async () => {
    const { source, scanner, states } = setup();
    source.startError = new PermissionDeniedError('denied');
    await expect(scanner.start()).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(scanner.state).toBe(ScannerState.Idle);
    expect(states).toEqual([ScannerState.Starting, ScannerState.Idle]);
  });

  it('cancels starts that a later stop() supersedes', async () => {
    const { source, scanner } = setup();
    const outcomes = await Promise.all(
      [scanner.start(), scanner.start(), scanner.stop()].map(settle),
    );
    expect(outcomes[0]).toEqual({ reason: expect.any(OperationCancelledError) });
    expect(outcomes[1]).toEqual({ reason: expect.any(OperationCancelledError) });
    expect(outcomes[2]).toEqual({ value: undefined });
    expect(source.starts).toHaveLength(0);
    expect(scanner.state).toBe(ScannerState.Idle);
  });

  it('stop() cancels a start that is waiting on a permission prompt', async () => {
    const { source, scanner, detections } = setup();
    source.gate = deferred();
    source.frame = BARCODE;
    const starting = settle(scanner.start());
    await vi.advanceTimersByTimeAsync(0);

    await scanner.stop();
    expect(await starting).toEqual({ reason: expect.any(OperationCancelledError) });
    expect(scanner.state).toBe(ScannerState.Idle);
    expect(source.isActive).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(detections).toHaveLength(0);
  });

  it('discards a late start from a source that cannot be cancelled', async () => {
    const { source, scanner } = setup();
    source.gate = deferred();
    source.cancellable = false;
    const starting = settle(scanner.start());
    await vi.advanceTimersByTimeAsync(0);

    const stopping = scanner.stop();
    source.gate.resolve();
    await stopping;
    expect(await starting).toEqual({ reason: expect.any(OperationCancelledError) });
    expect(source.isActive).toBe(false);
    expect(scanner.state).toBe(ScannerState.Idle);
  });

  it('dispose() delivers the final "idle", then detaches listeners', async () => {
    const { source, scanner, states, detections } = setup();
    source.gate = deferred();
    source.frame = BARCODE;
    const starting = settle(scanner.start());
    await vi.advanceTimersByTimeAsync(0);

    await scanner.dispose();
    expect(await starting).toEqual({ reason: expect.any(OperationCancelledError) });
    expect(states).toEqual([ScannerState.Starting, ScannerState.Idle]);

    // Listeners are gone: scanning again reaches none of them.
    source.gate = null;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(states).toEqual([ScannerState.Starting, ScannerState.Idle]);
    expect(detections).toHaveLength(0);
  });

  it('switches cameras by restarting the source', async () => {
    const { source, scanner } = setup();
    await scanner.start();
    await scanner.switchCamera('rear');
    await scanner.start({ deviceId: 'rear' }); // same device → no restart
    expect(source.starts).toEqual([{}, { deviceId: 'rear' }]);
    expect(scanner.activeDeviceId).toBe('rear');
    await expect(scanner.switchCamera('')).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it('never reports a false "idle" while switching cameras', async () => {
    const { scanner, states } = setup();
    await scanner.start();
    await scanner.switchCamera('rear');
    expect(states).toEqual([
      ScannerState.Starting,
      ScannerState.Scanning,
      ScannerState.Starting,
      ScannerState.Scanning,
    ]);
  });

  it('emits an error and stops when the stream ends unexpectedly', async () => {
    const { source, scanner, errors } = setup();
    await scanner.start();
    source.isActive = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toEqual([expect.any(CameraUnavailableError)]);
    expect(scanner.state).toBe(ScannerState.Idle);
  });

  it('keeps scanning after an isolated frame failure, reported with a stable code', async () => {
    const { source, scanner, errors } = setup();
    let fail = true;
    let stateWhenReported: ScannerState | undefined;
    scanner.on(ScannerEvent.Error, () => (stateWhenReported = scanner.state));
    vi.spyOn(source, 'grabFrame').mockImplementation(() => {
      if (fail) {
        fail = false;
        throw 'bad frame';
      }
      return luminanceFromRgba(BARCODE);
    });
    const detected = new Promise<ScanResult>((resolve) => scanner.on(ScannerEvent.Detect, resolve));
    await scanner.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(FrameProcessingError);
    expect(errors[0]!.code).toBe(ErrorCode.FrameProcessingFailed);
    expect(errors[0]!.cause).toBe('bad frame');
    // Listeners can tell a recoverable error apart: the scanner is still scanning.
    expect(stateWhenReported).toBe(ScannerState.Scanning);
    await expect(detected).resolves.toMatchObject({ text: 'SCAN-1' });
  });

  it('counts only processed frames towards the failure limit', async () => {
    // A source that alternates "not ready yet" and failing must still reach the limit.
    const { source, scanner, errors } = setup();
    let tick = 0;
    vi.spyOn(source, 'grabFrame').mockImplementation(() => {
      if (tick++ % 2 === 0) return null;
      throw new Error('broken pipeline');
    });
    await scanner.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(errors).toHaveLength(5);
    expect(scanner.state).toBe(ScannerState.Idle);
  });

  it('stops after repeated frame failures instead of erroring forever', async () => {
    const { source, scanner, errors } = setup();
    vi.spyOn(source, 'grabFrame').mockImplementation(() => {
      throw new Error('broken pipeline');
    });
    await scanner.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(errors).toHaveLength(5);
    expect(errors.every((error) => error instanceof FrameProcessingError)).toBe(true);
    expect(scanner.state).toBe(ScannerState.Idle);
    expect(source.isActive).toBe(false);
  });

  it.each([
    [
      'a missing canvas',
      () => new UnsupportedBrowserError('Canvas 2D rendering is not available.'),
    ],
    ['an invalid frame', () => new InvalidArgumentError('Invalid image.')],
  ])('stops at once on an unrecoverable frame error (%s)', async (_case, createError) => {
    const { source, scanner, errors } = setup();
    const error = createError();
    let stateWhenReported: ScannerState | undefined;
    scanner.on(ScannerEvent.Error, () => (stateWhenReported = scanner.state));
    vi.spyOn(source, 'grabFrame').mockImplementation(() => {
      throw error;
    });
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toEqual([error]);
    expect(stateWhenReported).toBe(ScannerState.Idle);
  });

  it('reports errors globally when there is no error listener', async () => {
    const source = new FakeFrameSource();
    const scanner = new Code39Scanner({ frameSource: source });
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    await scanner.start();
    source.isActive = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(report).toHaveBeenCalledWith(expect.any(CameraUnavailableError));
  });

  it('skips frames while the page is hidden', async () => {
    const { source, scanner, detections } = setup();
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(source.grabs).toBe(0);
    expect(detections).toHaveLength(0);
  });

  it('allows a detect listener to stop the scanner', async () => {
    const { source, scanner } = setup();
    source.frame = BARCODE;
    scanner.on(ScannerEvent.Detect, () => void scanner.stop());
    await scanner.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(scanner.state).toBe(ScannerState.Idle);
  });
});
