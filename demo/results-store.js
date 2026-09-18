/**
 * Scan history persisted in localStorage and shared by all open tabs. Newest entries first,
 * capped in size.
 *
 * - While storage mirrors this tab's history, every write re-reads it first, and changes from
 *   other tabs arrive through the `storage` event, so tabs never overwrite each other's scans.
 * - When storage cannot hold the history (unavailable, blocked, quota exceeded), the in-memory
 *   history stays authoritative: changes from other tabs are merged into it instead of replacing
 *   it, and saving is retried on every change.
 * - "Clear" increments a generation counter, and every scan is tagged with the generation it was
 *   made in. Merges keep only the newest generation, so a clear is never undone, and no clock is
 *   involved. When a tab clears while another tab holds scans it has not seen, the clear wins.
 * - History is stored under a versioned key. The previous format (a plain array under the v1
 *   key) is read once for migration but never written, so older builds keep their own data.
 *
 * @typedef {{ readonly id: string, readonly text: string, readonly timestamp: number, readonly generation: number }} StoredResult
 * @typedef {{ readonly generation: number, readonly results: readonly StoredResult[] }} History
 * @typedef {(results: readonly StoredResult[]) => void} ResultsListener
 * @typedef {Pick<EventTarget, 'addEventListener' | 'removeEventListener'>} StorageEventSource
 */

export const STORAGE_KEY = 'code39-scanner:results:v2';
/** Where earlier versions stored a plain array. Read for migration only; never written. */
export const LEGACY_STORAGE_KEY = 'code39-scanner:results:v1';
export const MAX_RESULTS = 500;

/** @type {History} */
const EMPTY_HISTORY = Object.freeze({ generation: 0, results: Object.freeze([]) });

/** @returns {Storage | null} */
function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage throws when storage is blocked.
    return null;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null;

/** @param {unknown} value @returns {value is number} */
const isGeneration = (value) => Number.isInteger(value) && /** @type {number} */ (value) >= 0;

/**
 * Whether `value` is a time the list can display: finite and within the range of `Date`
 * (±8.64e15 ms). Anything else would make date formatting throw.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
const isTimestamp = (value) =>
  typeof value === 'number' && !Number.isNaN(new Date(value).getTime());

/**
 * A scan entry from either storage format (the generation is checked separately). Storage is
 * shared with other tabs and older builds, so every field is validated before use.
 *
 * @param {unknown} value
 * @returns {value is { id: string, text: string, timestamp: number }}
 */
function isScanEntry(value) {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    isTimestamp(value.timestamp)
  );
}

/**
 * Normalized history: only entries of `generation`, capped, frozen. Order is preserved.
 *
 * @param {number} generation
 * @param {readonly StoredResult[]} results Newest first.
 * @returns {History}
 */
function createHistory(generation, results) {
  return Object.freeze({
    generation,
    results: Object.freeze(
      results
        .filter((entry) => entry.generation === generation)
        .slice(0, MAX_RESULTS)
        .map(({ id, text, timestamp }) => Object.freeze({ id, text, timestamp, generation })),
    ),
  });
}

/**
 * An entry of the current format: a scan entry tagged with its generation.
 *
 * @param {unknown} value
 * @returns {value is StoredResult}
 */
const isStoredResult = (value) =>
  isRecord(value) && isGeneration(value.generation) && isScanEntry(value);

/**
 * Parses the current `{ generation, results }` format.
 *
 * @param {unknown} data
 * @returns {History | null} `null` for unrecognized data.
 */
function parseHistory(data) {
  if (!isRecord(data) || !isGeneration(data.generation) || !Array.isArray(data.results)) {
    return null;
  }
  return createHistory(data.generation, data.results.filter(isStoredResult));
}

/**
 * Parses the legacy format: a plain array of scans, all in generation 0.
 *
 * @param {unknown} data
 * @returns {History}
 */
function parseLegacyHistory(data) {
  if (!Array.isArray(data)) return EMPTY_HISTORY;
  const entries = data.filter(isScanEntry).map((entry) => ({ ...entry, generation: 0 }));
  return createHistory(0, entries);
}

/**
 * Union of two histories by id, keeping only the newest generation.
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
  return createHistory(Math.max(ours.generation, theirs.generation), newestFirst);
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
    // `key` is null when another tab cleared all of storage. Writes by older builds to the
    // legacy key are ignored.
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
    // Build on the shared history only while storage mirrors ours; otherwise ours is newer.
    const base = (this.#inSync && this.#readStorage()) || this.#history;
    const entry = Object.freeze({ id: createId(), text, timestamp, generation: base.generation });
    this.#write(createHistory(base.generation, [entry, ...base.results]));
    return entry;
  }

  /** Removes every scan made so far, in all tabs. */
  clear() {
    const stored = this.#readStorage();
    const generation = Math.max(this.#history.generation, stored?.generation ?? 0) + 1;
    this.#write(createHistory(generation, []));
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
      if (raw !== null) return parseHistory(JSON.parse(raw));
      const legacy = this.#storage.getItem(LEGACY_STORAGE_KEY);
      return legacy === null ? EMPTY_HISTORY : parseLegacyHistory(JSON.parse(legacy));
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
