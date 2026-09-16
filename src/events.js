import { InvalidArgumentError } from './errors.js';
import { getOrInsert } from './utils.js';

/** @typedef {(payload: any) => void} Listener */

/**
 * Minimal strongly-typed event emitter. A throwing listener never prevents other listeners
 * (or the caller) from running; its error is re-thrown asynchronously so it still surfaces.
 * @template {object} Events
 */
export class TypedEventEmitter {
  #listeners = new Map();

  /**
   * Subscribes to `type`. Returns an unsubscribe function.
   * @template {keyof Events} K
   * @param {K} type
   * @param {Listener<Events[K]>} listener
   * @returns {() => void}
   */
  on(type, listener) {
    if (typeof listener !== 'function') {
      throw new InvalidArgumentError('Listener must be a function.');
    }
    getOrInsert(this.#listeners, type, () => new Set()).add(listener);
    return () => this.off(type, listener);
  }

  /**
   * @template {keyof Events} K
   * @param {K} type
   * @param {Listener<Events[K]>} listener
   */
  off(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  /**
   * Invokes the listeners of `type`. Returns `false` if there were none.
   * @template {keyof Events} K
   * @param {K} type
   * @param {Events[K]} payload
   * @returns {boolean}
   */
  emit(type, payload) {
    const listeners = this.#listeners.get(type);
    if (!listeners?.size) return false;
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    return true;
  }

  clear() {
    this.#listeners.clear();
  }
}