import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidArgumentError } from '../src/errors.js';
import { TypedEventEmitter } from '../src/events.js';

interface Events {
  ping: number;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TypedEventEmitter', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const emitter = new TypedEventEmitter<Events>();
    const listener = vi.fn();
    const unsubscribe = emitter.on('ping', listener);
    expect(emitter.emit('ping', 1)).toBe(true);
    unsubscribe();
    expect(emitter.emit('ping', 2)).toBe(false);
    expect(listener).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('isolates a throwing listener and re-throws asynchronously', () => {
    const deferred: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => deferred.push(cb));
    const emitter = new TypedEventEmitter<Events>();
    const second = vi.fn();
    emitter.on('ping', () => {
      throw new Error('boom');
    });
    emitter.on('ping', second);
    emitter.emit('ping', 1);
    expect(second).toHaveBeenCalledWith(1);
    expect(deferred).toHaveLength(1);
    expect(() => deferred[0]!()).toThrow('boom');
  });

  it('rejects non-function listeners and can be cleared', () => {
    const emitter = new TypedEventEmitter<Events>();
    expect(() => emitter.on('ping', null as unknown as () => void)).toThrow(InvalidArgumentError);
    emitter.on('ping', vi.fn());
    emitter.clear();
    expect(emitter.emit('ping', 1)).toBe(false);
  });
});
