import { describe, expect, it } from 'vitest';
import {
  CameraUnavailableError,
  Code39ScannerError,
  ErrorCode,
  FrameProcessingError,
  InsecureContextError,
  InvalidArgumentError,
  InvalidOptionsError,
  OperationCancelledError,
  PermissionDeniedError,
  UnsupportedBrowserError,
} from '@/errors.js';

const ERROR_CLASSES = [
  { ErrorClass: InvalidOptionsError, name: 'InvalidOptionsError', code: ErrorCode.InvalidOptions },
  {
    ErrorClass: InvalidArgumentError,
    name: 'InvalidArgumentError',
    code: ErrorCode.InvalidArgument,
  },
  {
    ErrorClass: UnsupportedBrowserError,
    name: 'UnsupportedBrowserError',
    code: ErrorCode.UnsupportedBrowser,
  },
  {
    ErrorClass: InsecureContextError,
    name: 'InsecureContextError',
    code: ErrorCode.InsecureContext,
  },
  {
    ErrorClass: PermissionDeniedError,
    name: 'PermissionDeniedError',
    code: ErrorCode.PermissionDenied,
  },
  {
    ErrorClass: CameraUnavailableError,
    name: 'CameraUnavailableError',
    code: ErrorCode.CameraUnavailable,
  },
  {
    ErrorClass: OperationCancelledError,
    name: 'OperationCancelledError',
    code: ErrorCode.OperationCancelled,
  },
  {
    ErrorClass: FrameProcessingError,
    name: 'FrameProcessingError',
    code: ErrorCode.FrameProcessingFailed,
  },
] as const;

describe('errors', () => {
  it.each(ERROR_CLASSES)(
    '$name has a minification-safe name and a stable code',
    ({ ErrorClass, name, code }) => {
      const cause = new Error('root cause');
      const error = new ErrorClass('message', { cause });
      expect(error).toBeInstanceOf(Code39ScannerError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      expect(error.code).toBe(code);
      expect(error.message).toBe('message');
      expect(error.cause).toBe(cause);
    },
  );

  it('maps every error code to exactly one error class', () => {
    const codes = Object.values(ErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(ERROR_CLASSES.map(({ code }) => code).sort()).toEqual([...codes].sort());
    expect(Object.isFrozen(ErrorCode)).toBe(true);
  });
});
