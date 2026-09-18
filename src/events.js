import { InvalidArgumentError } from './errors.js';
import { getOrInsert } from './utils.js';

/**
 * @template T
 * @typedef {(payload: T) => void} Listener
 */

/**
 * Minimal event emitter. A throwing listener never prevents other listeners (or the caller)
 * from running; its error is re-thrown asynchronously so it still surfaces.
 */
export class TypedEventEmitter {
  /** @type {Map<string, Set<Listener<any>>>} */
  #listeners = new Map();

  /**
   * Subscribes to `type`. Returns an unsubscribe function.
   * @param {string} type
   * @param {Listener<any>} listener
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
   * @param {string} type
   * @param {Listener<any>} listener
   */
  off(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  /**
   * Invokes the listeners of `type`. Returns `false` if there were none.
   * @param {string} type
   * @param {unknown} payload
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
