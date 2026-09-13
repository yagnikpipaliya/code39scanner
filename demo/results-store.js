/**
 * Scan history persisted in localStorage. Newest entries first and capped in size.
 *
 * - Every write re-reads storage first, so tabs never overwrite each other's scans.
 * - Changes made in other tabs are picked up through the `storage` event.
 * - Unavailable storage (private mode, blocked, quota) degrades to in-memory history, and
 *   corrupted data is ignored.
 *
 * @typedef {{ readonly id: string, readonly text: string, readonly timestamp: number }} StoredResult
 * @typedef {(results: readonly StoredResult[]) => void} ResultsListener
 */

const STORAGE_KEY = 'code39-scanner:results:v1';
export const MAX_RESULTS = 500;

/** @type {readonly StoredResult[]} */
const EMPTY = Object.freeze([]);

/** @returns {Storage | null} */
function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage throws when storage is blocked.
    return null;
  }
}

/** @param {unknown} value @returns {value is StoredResult} */
function isStoredResult(value) {
  if (typeof value !== 'object' || value === null) return false;
  const entry = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof entry.id === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.timestamp === 'number' &&
    Number.isFinite(entry.timestamp)
  );
}

/** @returns {string} */
const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class ResultsStore {
  /** @type {Storage | null} */
  #storage;
  /** @type {readonly StoredResult[]} */
  #results = EMPTY;
  /** @type {Set<ResultsListener>} */
  #listeners = new Set();

  /** @param {StorageEvent} event */
  #onStorage = (event) => {
    // `key` is null when another tab cleared all of storage.
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    this.#results = this.#read();
    this.#notify();
  };

  /** @param {Storage | null} [storage] */
  constructor(storage = getLocalStorage()) {
    this.#storage = storage;
    this.#results = this.#read();
    globalThis.addEventListener?.('storage', this.#onStorage);
  }

  /** @returns {readonly StoredResult[]} */
  get results() {
    return this.#results;
  }

  /** @param {{ text: string, timestamp: number }} result @returns {StoredResult} */
  add({ text, timestamp }) {
    const entry = Object.freeze({ id: createId(), text, timestamp });
    this.#write([entry, ...this.#read()]);
    return entry;
  }

  clear() {
    this.#write(EMPTY);
  }

  /** Calls `listener` now and after every change. @param {ResultsListener} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#results);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    globalThis.removeEventListener?.('storage', this.#onStorage);
    this.#listeners.clear();
  }

  /** Latest persisted history; falls back to the in-memory copy when storage is unusable. */
  /** @returns {readonly StoredResult[]} */
  #read() {
    if (!this.#storage) return this.#results;
    try {
      const parsed = JSON.parse(this.#storage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) return EMPTY;
      return Object.freeze(
        parsed
          .filter(isStoredResult)
          .slice(0, MAX_RESULTS)
          .map((entry) => Object.freeze(entry)),
      );
    } catch {
      return this.#results;
    }
  }

  /** @param {readonly StoredResult[]} results */
  #write(results) {
    this.#results = Object.freeze(results.slice(0, MAX_RESULTS));
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#results));
    } catch (error) {
      console.warn('Scan history could not be saved.', error);
    }
    this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) listener(this.#results);
  }
}
