/**
 * Scan history persisted in localStorage. Newest entries first, capped in size, and resilient
 * to unavailable storage (private mode, quota) and corrupted data.
 *
 * @typedef {{ readonly id: string, readonly text: string, readonly timestamp: number }} StoredResult
 * @typedef {(results: readonly StoredResult[]) => void} ResultsListener
 */

const STORAGE_KEY = 'code39-scanner:results:v1';
export const MAX_RESULTS = 500;

/** @returns {Storage | null} */
function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage throws when storage is blocked.
    return null;
  }
}

/** @param {unknown} entry @returns {entry is StoredResult} */
const isStoredResult = (entry) =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof entry.id === 'string' &&
  typeof entry.text === 'string' &&
  Number.isFinite(entry.timestamp);

const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class ResultsStore {
  /** @type {Storage | null} */
  #storage;
  /** @type {readonly StoredResult[]} */
  #results;
  /** @type {Set<ResultsListener>} */
  #listeners = new Set();

  /** @param {Storage | null} [storage] */
  constructor(storage = getLocalStorage()) {
    this.#storage = storage;
    this.#results = this.#load();
  }

  /** @returns {readonly StoredResult[]} */
  get results() {
    return this.#results;
  }

  /** @param {{ text: string, timestamp: number }} result @returns {StoredResult} */
  add({ text, timestamp }) {
    const entry = Object.freeze({ id: createId(), text, timestamp });
    this.#results = Object.freeze([entry, ...this.#results].slice(0, MAX_RESULTS));
    this.#commit();
    return entry;
  }

  clear() {
    this.#results = Object.freeze([]);
    this.#commit();
  }

  /** Calls `listener` now and after every change. @param {ResultsListener} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#results);
    return () => this.#listeners.delete(listener);
  }

  #commit() {
    this.#save();
    for (const listener of this.#listeners) listener(this.#results);
  }

  /** @returns {readonly StoredResult[]} */
  #load() {
    try {
      const parsed = JSON.parse(this.#storage?.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) return Object.freeze([]);
      return Object.freeze(parsed.filter(isStoredResult).slice(0, MAX_RESULTS).map(Object.freeze));
    } catch {
      return Object.freeze([]);
    }
  }

  #save() {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#results));
    } catch (error) {
      console.warn('Scan history could not be saved.', error);
    }
  }
}
