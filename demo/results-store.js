/**
 * Scan history persisted in localStorage and shared by all open tabs. Newest entries first,
 * capped in size.
 *
 * - While storage mirrors this tab's history, every write re-reads it first, and changes from
 *   other tabs arrive through the `storage` event, so tabs never overwrite each other's scans.
 * - When storage cannot hold the history (unavailable, blocked, quota exceeded), the in-memory
 *   history stays authoritative: changes from other tabs are merged into it instead of replacing
 *   it, and saving is retried on every change.
 * - "Clear" is recorded as a point in time (`clearedAt`), not just an empty list. A merge can then
 *   tell a cleared scan from one another tab has not seen yet: scans made before the latest clear
 *   are dropped, later ones are kept — whichever tab cleared.
 * - History saved by earlier versions (a plain array) is read, and corrupted data is ignored.
 *
 * @typedef {{ readonly id: string, readonly text: string, readonly timestamp: number }} StoredResult
 * @typedef {{ readonly clearedAt: number, readonly results: readonly StoredResult[] }} History
 * @typedef {(results: readonly StoredResult[]) => void} ResultsListener
 * @typedef {Pick<EventTarget, 'addEventListener' | 'removeEventListener'>} StorageEventSource
 */

export const STORAGE_KEY = 'code39-scanner:results:v1';
export const MAX_RESULTS = 500;

/** @type {History} */
const EMPTY_HISTORY = Object.freeze({ clearedAt: 0, results: Object.freeze([]) });

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

/**
 * Normalized history: only scans made after the clear, capped, frozen. Order is preserved.
 *
 * @param {number} clearedAt
 * @param {readonly StoredResult[]} results Newest first.
 * @returns {History}
 */
function createHistory(clearedAt, results) {
  return Object.freeze({
    clearedAt,
    results: Object.freeze(
      results
        .filter((entry) => entry.timestamp > clearedAt)
        .slice(0, MAX_RESULTS)
        .map(({ id, text, timestamp }) => Object.freeze({ id, text, timestamp })),
    ),
  });
}

/**
 * Parses stored history: the current `{ clearedAt, results }` shape or a legacy plain array.
 *
 * @param {unknown} data
 * @returns {History | null} `null` for unrecognized data.
 */
function parseHistory(data) {
  if (Array.isArray(data)) return createHistory(0, data.filter(isStoredResult));
  if (typeof data !== 'object' || data === null) return null;
  const { clearedAt, results } = /** @type {Record<string, unknown>} */ (data);
  if (typeof clearedAt !== 'number' || !Number.isFinite(clearedAt) || !Array.isArray(results)) {
    return null;
  }
  return createHistory(clearedAt, results.filter(isStoredResult));
}

/**
 * Union of two histories by id, honouring the later of their clears.
 *
 * @param {History} ours
 * @param {History} theirs
 * @returns {History}
 */
function mergeHistories(ours, theirs) {
  /** @type {Map<string, StoredResult>} */
  const byId = new Map();
  for (const entry of [...theirs.results, ...ours.results]) byId.set(entry.id, entry);
  const newestFirst = [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  return createHistory(Math.max(ours.clearedAt, theirs.clearedAt), newestFirst);
}

/** @returns {string} */
const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class ResultsStore {
  /** @type {Storage | null} */
  #storage;
  /** @type {StorageEventSource | null} */
  #events;
  /** @type {History} */
  #history = EMPTY_HISTORY;
  /** Whether storage currently holds exactly this tab's history. */
  #inSync = false;
  /** @type {Set<ResultsListener>} */
  #listeners = new Set();

  /** @param {Event} event */
  #onStorage = (event) => {
    // `key` is null when another tab cleared all of storage.
    const { key } = /** @type {StorageEvent} */ (event);
    if (key !== STORAGE_KEY && key !== null) return;
    const stored = this.#readStorage();
    if (!stored) return;
    if (this.#inSync) {
      this.#history = stored;
      this.#notify();
    } else {
      // This tab holds scans that were never saved: merge instead of replacing, and retry saving.
      this.#write(mergeHistories(this.#history, stored));
    }
  };

  /**
   * @param {Storage | null} [storage]
   * @param {StorageEventSource | null} [events] Where `storage` events arrive (the window).
   */
  constructor(storage = getLocalStorage(), events = globalThis) {
    this.#storage = storage;
    this.#events = events;
    const stored = this.#readStorage();
    this.#history = stored ?? EMPTY_HISTORY;
    this.#inSync = stored !== null;
    events?.addEventListener('storage', this.#onStorage);
  }

  /** @returns {readonly StoredResult[]} Newest first. */
  get results() {
    return this.#history.results;
  }

  /** @param {{ text: string, timestamp: number }} result @returns {StoredResult} */
  add({ text, timestamp }) {
    const entry = Object.freeze({ id: createId(), text, timestamp });
    // Build on the shared history only while storage mirrors ours; otherwise ours is newer.
    const base = (this.#inSync && this.#readStorage()) || this.#history;
    this.#write(createHistory(base.clearedAt, [entry, ...base.results]));
    return entry;
  }

  /** Removes every scan made up to now, in all tabs. */
  clear() {
    const stored = this.#readStorage();
    const clearedAt = Math.max(Date.now(), this.#history.clearedAt, stored?.clearedAt ?? 0);
    this.#write(createHistory(clearedAt, []));
  }

  /** Calls `listener` now and after every change. @param {ResultsListener} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#history.results);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#events?.removeEventListener('storage', this.#onStorage);
    this.#listeners.clear();
  }

  /** Persisted history, or `null` when storage is unusable or holds unrecognized data. */
  /** @returns {History | null} */
  #readStorage() {
    if (!this.#storage) return null;
    try {
      const raw = this.#storage.getItem(STORAGE_KEY);
      return raw === null ? EMPTY_HISTORY : parseHistory(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** @param {History} history */
  #write(history) {
    this.#history = history;
    this.#inSync = this.#persist(history);
    this.#notify();
  }

  /** @param {History} history @returns {boolean} Whether the save succeeded. */
  #persist(history) {
    if (!this.#storage) return false;
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(history));
      return true;
    } catch (error) {
      // Warn once when saving starts failing, not on every retry.
      if (this.#inSync) {
        console.warn('Scan history could not be saved; keeping it in memory.', error);
      }
      return false;
    }
  }

  #notify() {
    for (const listener of this.#listeners) listener(this.#history.results);
  }
}
