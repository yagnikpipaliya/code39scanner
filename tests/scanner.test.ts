import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameSource, StartOptions } from '../src/camera/frame-source.js';
import { Code39Scanner } from '../src/camera/scanner.js';
import {
  CameraUnavailableError,
  InvalidOptionsError,
  PermissionDeniedError,
} from '../src/errors.js';
import type { RgbaImage, ScanResult } from '../src/types.js';
import { renderBarcode } from './helpers/encode.js';

const BARCODE = renderBarcode('SCAN-1', { narrow: 2 });
const OTHER = renderBarcode('SCAN-2', { narrow: 2 });
const BLANK: RgbaImage = {
  width: 100,
  height: 50,
  data: new Uint8ClampedArray(100 * 50 * 4).fill(230),
};

class FakeFrameSource implements FrameSource {
  frame: RgbaImage | null = null;
  isActive = false;
  activeDeviceId: string | undefined;
  startError: Error | null = null;
  readonly starts: StartOptions[] = [];
  grabs = 0;
  stops = 0;

  async start(options: StartOptions): Promise<void> {
    this.starts.push(options);
    if (this.startError) throw this.startError;
    this.isActive = true;
    this.activeDeviceId = options.deviceId ?? 'default';
  }

  stop(): void {
    this.stops++;
    this.isActive = false;
  }

  grabFrame(): RgbaImage | null {
    this.grabs++;
    return this.frame;
  }
}

function setup() {
  const source = new FakeFrameSource();
  const scanner = new Code39Scanner({ frameSource: source, scanIntervalMs: 100 });
  const detections: ScanResult[] = [];
  const errors: Error[] = [];
  const states: string[] = [];
  scanner.on('detect', (r) => detections.push(r));
  scanner.on('error', (e) => errors.push(e));
  scanner.on('statechange', (s) => states.push(s));
  return { source, scanner, detections, errors, states };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    expect(scanner.state).toBe('scanning');
    expect(states).toEqual(['starting', 'scanning']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.grabs).toBeGreaterThanOrEqual(10);
    expect(scanner.activeDeviceId).toBe('default');
  });

  it('emits one detection per appearance of a barcode', async () => {
    const { source, scanner, detections } = setup();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ text: 'SCAN-1', format: 'CODE_39' });
    expect(detections[0]!.timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'));

    // Out of view longer than the presence timeout, then back in view → reported again.
    source.frame = BLANK;
    await vi.advanceTimersByTimeAsync(2000);
    source.frame = BARCODE;
    await vi.advanceTimersByTimeAsync(500);
    expect(detections.map((d) => d.text)).toEqual(['SCAN-1', 'SCAN-1']);
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

  it('stops scanning and releases the source', async () => {
    const { source, scanner, states } = setup();
    await scanner.start();
    await scanner.stop();
    const grabs = source.grabs;
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.grabs).toBe(grabs);
    expect(source.isActive).toBe(false);
    expect(states.at(-1)).toBe('idle');
  });

  it('propagates start failures and returns to idle', async () => {
    const { source, scanner, states } = setup();
    source.startError = new PermissionDeniedError('denied');
    await expect(scanner.start()).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(scanner.state).toBe('idle');
    expect(states).toEqual(['starting', 'idle']);
  });

  it('serializes overlapping lifecycle calls', async () => {
    const { source, scanner } = setup();
    const results = await Promise.all([scanner.start(), scanner.start(), scanner.stop()]);
    expect(results).toEqual([undefined, undefined, undefined]);
    expect(source.starts).toHaveLength(1);
    expect(scanner.state).toBe('idle');
  });

  it('switches cameras by restarting the source', async () => {
    const { source, scanner } = setup();
    await scanner.start();
    await scanner.switchCamera('rear');
    await scanner.start({ deviceId: 'rear' }); // same device → no restart
    expect(source.starts).toEqual([{}, { deviceId: 'rear' }]);
    expect(scanner.activeDeviceId).toBe('rear');
    await expect(scanner.switchCamera('')).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('emits an error and stops when the stream ends unexpectedly', async () => {
    const { source, scanner, errors } = setup();
    await scanner.start();
    source.isActive = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(errors[0]).toBeInstanceOf(CameraUnavailableError);
    expect(scanner.state).toBe('idle');
  });

  it('keeps scanning after a frame error', async () => {
    const { source, scanner, errors } = setup();
    let fail = true;
    vi.spyOn(source, 'grabFrame').mockImplementation(() => {
      if (fail) {
        fail = false;
        throw 'bad frame';
      }
      return BARCODE;
    });
    const detected = new Promise<ScanResult>((resolve) => scanner.on('detect', resolve));
    await scanner.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(errors[0]?.message).toBe('bad frame');
    await expect(detected).resolves.toMatchObject({ text: 'SCAN-1' });
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
    vi.unstubAllGlobals();
  });

  it('allows a detect listener to stop the scanner', async () => {
    const { source, scanner } = setup();
    source.frame = BARCODE;
    scanner.on('detect', () => void scanner.stop());
    await scanner.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(scanner.state).toBe('idle');
  });

  it('removes listeners on dispose', async () => {
    const { source, scanner, detections } = setup();
    await scanner.dispose();
    source.frame = BARCODE;
    await scanner.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(detections).toHaveLength(0);
  });
});
