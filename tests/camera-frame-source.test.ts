import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraFrameSource } from '@/camera/camera-frame-source.js';
import {
  CameraUnavailableError,
  InsecureContextError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from '@/errors.js';
import { Code39ImageDecoder } from '@/image/image-decoder.js';
import type { RgbaImage } from '@/types.js';
import { deferred, renderBarcode } from '@tests/helpers.js';

interface FakeTrack {
  readyState: 'live' | 'ended';
  stop(): void;
  getSettings(): { deviceId: string };
}

function fakeStream(deviceId = 'camera-1') {
  const track: FakeTrack = {
    readyState: 'live',
    stop() {
      track.readyState = 'ended';
    },
    getSettings: () => ({ deviceId }),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { track, stream: stream as unknown as MediaStream };
}

function fakeVideo() {
  return {
    srcObject: null as MediaStream | null,
    muted: false,
    playsInline: false,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    play: vi.fn(async () => undefined),
    setAttribute: vi.fn(),
  };
}

const asVideo = (video: ReturnType<typeof fakeVideo>) => video as unknown as HTMLVideoElement;

function stubMediaDevices(
  getUserMedia: (...args: unknown[]) => Promise<MediaStream>,
  enumerateDevices: () => Promise<Partial<MediaDeviceInfo>[]> = async () => [],
) {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } });
}

/**
 * Replaces `OffscreenCanvas` with a fake whose 2D context serves `getImageData` from `frame`
 * and records every read region as [x, y, width, height].
 */
function stubCanvas(frame?: RgbaImage) {
  const drawImage = vi.fn();
  const reads: [number, number, number, number][] = [];
  const getImageData = (x: number, y: number, width: number, height: number) => {
    reads.push([x, y, width, height]);
    const data = new Uint8ClampedArray(width * height * 4);
    if (frame) {
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const src = ((y + row) * frame.width + x + col) * 4;
          data.set(frame.data.subarray(src, src + 4), (row * width + col) * 4);
        }
      }
    }
    return { width, height, data };
  };
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { canvas: this, drawImage, getImageData };
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return { drawImage, reads };
}

beforeEach(() => {
  stubCanvas();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CameraFrameSource', () => {
  it('validates constructor arguments', () => {
    expect(() => new CameraFrameSource(null as unknown as HTMLVideoElement)).toThrow(
      InvalidOptionsError,
    );
    for (const maxFrameSize of [0, Number.NaN, 640.5, 10_000]) {
      expect(() => new CameraFrameSource(asVideo(fakeVideo()), { maxFrameSize })).toThrow(
        InvalidOptionsError,
      );
    }
  });

  it('is supported only with the camera API and a working 2D context', () => {
    vi.stubGlobal('navigator', {});
    expect(CameraFrameSource.isSupported()).toBe(false);
    stubMediaDevices(vi.fn());
    expect(CameraFrameSource.isSupported()).toBe(true);
    // A canvas that cannot provide a 2D context (blocked, or the context limit reached).
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      },
    );
    expect(CameraFrameSource.isSupported()).toBe(false);
    vi.stubGlobal('OffscreenCanvas', undefined); // and no `document` in Node
    expect(CameraFrameSource.isSupported()).toBe(false);
  });

  it('rejects in insecure contexts and unsupported browsers', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(new CameraFrameSource(asVideo(fakeVideo())).start()).rejects.toBeInstanceOf(
      InsecureContextError,
    );
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {});
    await expect(new CameraFrameSource(asVideo(fakeVideo())).start()).rejects.toBeInstanceOf(
      UnsupportedBrowserError,
    );
  });

  it('refuses to start without a 2D canvas, before switching the camera on', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      },
    );
    const getUserMedia = vi.fn(async () => fakeStream().stream);
    stubMediaDevices(getUserMedia);
    await expect(new CameraFrameSource(asVideo(fakeVideo())).start()).rejects.toBeInstanceOf(
      UnsupportedBrowserError,
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('falls back to a regular canvas when OffscreenCanvas has no 2D context', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return null;
        }
      },
    );
    const drawImage = vi.fn();
    const context = {
      canvas: { width: 0, height: 0 },
      drawImage,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    stubMediaDevices(async () => fakeStream().stream);

    expect(CameraFrameSource.isSupported()).toBe(true);
    const video = Object.assign(fakeVideo(), { readyState: 4, videoWidth: 64, videoHeight: 48 });
    const source = new CameraFrameSource(asVideo(video));
    await source.start();
    expect(source.grabFrame()?.width).toBe(64);
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it('plays the rear camera in the video element and releases it on stop', async () => {
    const { stream, track } = fakeStream('rear');
    const getUserMedia = vi.fn(async () => stream);
    stubMediaDevices(getUserMedia);
    const video = fakeVideo();
    const source = new CameraFrameSource(asVideo(video));

    await source.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
    });
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(source.isActive).toBe(true);
    expect(source.activeDeviceId).toBe('rear');

    source.stop();
    expect(track.readyState).toBe('ended');
    expect(source.isActive).toBe(false);
    expect(video.srcObject).toBeNull();
  });

  it('requests a specific camera by id', async () => {
    const getUserMedia = vi.fn(async () => fakeStream('front').stream);
    stubMediaDevices(getUserMedia);
    await new CameraFrameSource(asVideo(fakeVideo())).start({ deviceId: 'front' });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: 'front' } }),
    });
  });

  it.each([
    ['NotAllowedError', PermissionDeniedError],
    ['SecurityError', PermissionDeniedError],
    ['NotFoundError', CameraUnavailableError],
    ['OverconstrainedError', CameraUnavailableError],
    ['NotReadableError', CameraUnavailableError],
    ['AbortError', CameraUnavailableError],
    ['SomethingElse', CameraUnavailableError],
  ] as const)('maps %s to a typed error that keeps the cause', async (name, ErrorClass) => {
    const cause = Object.assign(new Error('media failure'), { name });
    stubMediaDevices(async () => {
      throw cause;
    });
    const error = await new CameraFrameSource(asVideo(fakeVideo()))
      .start()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorClass);
    expect((error as Error).cause).toBe(cause);
  });

  it('releases the stream when playback fails', async () => {
    const { stream, track } = fakeStream();
    stubMediaDevices(async () => stream);
    const video = fakeVideo();
    video.play.mockRejectedValueOnce(new Error('autoplay blocked'));
    const source = new CameraFrameSource(asVideo(video));
    await expect(source.start()).rejects.toBeInstanceOf(CameraUnavailableError);
    expect(track.readyState).toBe('ended');
    expect(source.isActive).toBe(false);
  });

  it('cancels a pending start on stop() and releases the late stream', async () => {
    const pending = deferred<MediaStream>();
    stubMediaDevices(() => pending.promise);
    const source = new CameraFrameSource(asVideo(fakeVideo()));
    const starting = source.start();
    source.stop();
    const late = fakeStream();
    pending.resolve(late.stream);
    await expect(starting).rejects.toBeInstanceOf(OperationCancelledError);
    expect(late.track.readyState).toBe('ended');
    expect(source.isActive).toBe(false);
  });

  it('reports a superseded failure as a cancellation', async () => {
    const pending = deferred<MediaStream>();
    stubMediaDevices(() => pending.promise);
    const source = new CameraFrameSource(asVideo(fakeVideo()));
    const starting = source.start();
    source.stop();
    pending.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await expect(starting).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('lets the latest of two concurrent starts win without leaking the first stream', async () => {
    const first = deferred<MediaStream>();
    const second = fakeStream('second');
    const getUserMedia = vi
      .fn<() => Promise<MediaStream>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(second.stream);
    stubMediaDevices(getUserMedia);
    const source = new CameraFrameSource(asVideo(fakeVideo()));

    const superseded = source.start();
    await source.start({ deviceId: 'second' });
    const late = fakeStream('first');
    first.resolve(late.stream);

    await expect(superseded).rejects.toBeInstanceOf(OperationCancelledError);
    expect(late.track.readyState).toBe('ended');
    expect(source.activeDeviceId).toBe('second');
    expect(source.isActive).toBe(true);
  });

  it('lists cameras with fallback labels, skipping devices without ids', async () => {
    stubMediaDevices(vi.fn(), async () => [
      { kind: 'videoinput', deviceId: 'a', label: '' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      { kind: 'videoinput', deviceId: '', label: 'Hidden' },
      { kind: 'videoinput', deviceId: 'b', label: 'Back camera' },
    ]);
    await expect(CameraFrameSource.listCameras()).resolves.toEqual([
      { deviceId: 'a', label: 'Camera 1' },
      { deviceId: 'b', label: 'Back camera' },
    ]);
  });

  it('draws each frame once and reads back only the scanlines the decoder asks for', async () => {
    const frame = renderBarcode('LAZY', { narrow: 2 });
    const { drawImage, reads } = stubCanvas(frame);
    stubMediaDevices(async () => fakeStream().stream);
    const video = Object.assign(fakeVideo(), {
      readyState: 4,
      videoWidth: frame.width,
      videoHeight: frame.height,
    });
    const source = new CameraFrameSource(asVideo(video));
    await source.start();

    const luminance = source.grabFrame()!;
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(video, 0, 0, frame.width, frame.height);
    expect(new Code39ImageDecoder().decode(luminance)?.text).toBe('LAZY');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(([, , width, height]) => width === 1 || height === 1)).toBe(true);
  });

  it('downscales frames larger than maxFrameSize', async () => {
    const { drawImage } = stubCanvas();
    stubMediaDevices(async () => fakeStream().stream);
    const video = Object.assign(fakeVideo(), {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    });
    const source = new CameraFrameSource(asVideo(video), { maxFrameSize: 960 });
    await source.start();

    const luminance = source.grabFrame()!;
    expect([luminance.width, luminance.height]).toEqual([960, 540]);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 960, 540);
  });

  it('returns no frame before the stream has video data', async () => {
    stubMediaDevices(async () => fakeStream().stream);
    const source = new CameraFrameSource(asVideo(fakeVideo()));
    expect(source.grabFrame()).toBeNull();
    await source.start();
    expect(source.grabFrame()).toBeNull();
  });
});
