/**
 * Scan history persisted in localStorage. Newest entries first and capped in size.
 *
 * - While storage mirrors this tab's history, every write re-reads it first, so tabs never
 *   overwrite each other's scans; changes from other tabs arrive through the `storage` event.
 * - When storage cannot hold the history (unavailable, blocked, quota exceeded), the in-memory
 *   history stays authoritative, so nothing already shown is lost. Saving is retried on every
 *   change and storage becomes the shared source again once a save succeeds.
 * - Corrupted stored data is ignored.
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
  /** Whether storage currently holds exactly this tab's history. */
  #inSync = false;
  /** @type {Set<ResultsListener>} */
  #listeners = new Set();

  /** @param {StorageEvent} event */
  #onStorage = (event) => {
    // `key` is null when another tab cleared all of storage.
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const stored = this.#readStorage();
    if (!stored) return;
    this.#results = stored;
    this.#inSync = true;
    this.#notify();
  };

  /** @param {Storage | null} [storage] */
  constructor(storage = getLocalStorage()) {
    this.#storage = storage;
    const stored = this.#readStorage();
    this.#results = stored ?? EMPTY;
    this.#inSync = stored !== null;
    globalThis.addEventListener?.('storage', this.#onStorage);
  }

  /** @returns {readonly StoredResult[]} */
  get results() {
    return this.#results;
  }

  /** @param {{ text: string, timestamp: number }} result @returns {StoredResult} */
  add({ text, timestamp }) {
    const entry = Object.freeze({ id: createId(), text, timestamp });
    // Merge onto the shared history only while storage mirrors ours; otherwise ours is newer.
    const base = (this.#inSync && this.#readStorage()) || this.#results;
    this.#write([entry, ...base]);
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

  /** Persisted history, or `null` when storage is unusable or holds corrupted data. */
  /** @returns {readonly StoredResult[] | null} */
  #readStorage() {
    if (!this.#storage) return null;
    try {
      const parsed = JSON.parse(this.#storage.getItem(STORAGE_KEY) ?? '[]');
      if (!Array.isArray(parsed)) return null;
      return Object.freeze(
        parsed
          .filter(isStoredResult)
          .slice(0, MAX_RESULTS)
          .map((entry) => Object.freeze(entry)),
      );
    } catch {
      return null;
    }
  }

  /** @param {readonly StoredResult[]} results */
  #write(results) {
    this.#results = Object.freeze(results.slice(0, MAX_RESULTS));
    this.#inSync = this.#persist(this.#results);
    this.#notify();
  }

  /** @param {readonly StoredResult[]} results @returns {boolean} Whether the save succeeded. */
  #persist(results) {
    if (!this.#storage) return false;
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(results));
      return true;
    } catch (error) {
      if (this.#inSync)
        console.warn('Scan history could not be saved; keeping it in memory.', error);
      return false;
    }
  }

  #notify() {
    for (const listener of this.#listeners) listener(this.#results);
  }
}
