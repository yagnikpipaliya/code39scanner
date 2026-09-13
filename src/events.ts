import { InvalidArgumentError } from '@/errors.js';
import { getOrInsert } from '@/utils.js';

export type Listener<T> = (payload: T) => void;

/**
 * Minimal strongly-typed event emitter. A throwing listener never prevents other listeners
 * (or the caller) from running; its error is re-thrown asynchronously so it still surfaces.
 */
export class TypedEventEmitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Subscribes to `type`. Returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    if (typeof listener !== 'function') {
      throw new InvalidArgumentError('Listener must be a function.');
    }
    getOrInsert(this.#listeners, type, () => new Set()).add(listener);
    return () => this.off(type, listener);
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.#listeners.get(type)?.delete(listener);
  }

  /** Invokes the listeners of `type`. Returns `false` if there were none. */
  emit<K extends keyof Events>(type: K, payload: Events[K]): boolean {
    const listeners = this.#listeners.get(type);
    if (!listeners?.size) return false;
    for (const listener of [...listeners] as Listener<Events[K]>[]) {
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

  clear(): void {
    this.#listeners.clear();
  }
}
