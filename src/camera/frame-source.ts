import type { RgbaImage } from '../types.js';

export interface StartOptions {
  /** Camera to use. When omitted, the rear ("environment") camera is preferred. */
  readonly deviceId?: string | undefined;
}

/**
 * Abstraction over anything that can supply frames to the scanner. The camera implementation
 * is `CameraFrameSource`; tests and custom inputs provide their own.
 */
export interface FrameSource {
  start(options: StartOptions): Promise<void>;
  stop(): void;
  /** The current frame, or `null` if none is ready yet. */
  grabFrame(): RgbaImage | null;
  /** `false` once stopped or if the underlying stream ended. */
  readonly isActive: boolean;
  readonly activeDeviceId?: string | undefined;
}
