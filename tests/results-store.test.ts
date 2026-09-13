import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_STORAGE_KEY,
  MAX_RESULTS,
  ResultsStore,
  STORAGE_KEY,
} from '../demo/results-store.js';

/** In-memory `localStorage` that can simulate a full quota. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  full = false;

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.items.set(key, value);
  }

  stored(): { generation: number; results: { text: string }[] } {
    return JSON.parse(this.items.get(STORAGE_KEY) ?? 'null');
  }

  storedTexts(): string[] {
    return this.stored().results.map((result) => result.text);
  }
}

/** One browser tab: a store with its own target for `storage` events from other tabs. */
function openTab(storage: MemoryStorage) {
  const events = new EventTarget();
  const store = new ResultsStore(storage as unknown as Storage, events);
  return {
    store,
    texts: () => store.results.map((result) => result.text),
    /** Delivers the `storage` event the browser fires in this tab when another tab writes. */
    receiveStorageEvent: (key: string | null = STORAGE_KEY) =>
      events.dispatchEvent(Object.assign(new Event('storage'), { key })),
  };
}

const scan = (text: string, timestamp: number) => ({ text, timestamp });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ResultsStore', () => {
  it('persists history, newest first, and restores it in another tab', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.add(scan('FIRST', 1000));
    a.store.add(scan('SECOND', 2000));
    expect(a.texts()).toEqual(['SECOND', 'FIRST']);
    expect(openTab(storage).texts()).toEqual(['SECOND', 'FIRST']);
  });

  it('migrates history saved by earlier versions without modifying it', () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify([{ id: '1', text: 'LEGACY', timestamp: 5 }]);
    storage.items.set(LEGACY_STORAGE_KEY, legacy);

    const tab = openTab(storage);
    expect(tab.texts()).toEqual(['LEGACY']);
    tab.store.add(scan('NEW', 1000));
    expect(storage.storedTexts()).toEqual(['NEW', 'LEGACY']);
    // Older builds still find their own data untouched.
    expect(storage.items.get(LEGACY_STORAGE_KEY)).toBe(legacy);
  });

  it('ignores writes by older builds to the legacy key', () => {
    const storage = new MemoryStorage();
    const tab = openTab(storage);
    tab.store.add(scan('CURRENT', 1000));
    storage.items.set(LEGACY_STORAGE_KEY, JSON.stringify([]));
    tab.receiveStorageEvent(LEGACY_STORAGE_KEY);
    expect(tab.texts()).toEqual(['CURRENT']);
  });

  it('ignores corrupted data and repairs it on the next write', () => {
    const storage = new MemoryStorage();
    storage.items.set(STORAGE_KEY, '{not json');
    const tab = openTab(storage);
    expect(tab.texts()).toEqual([]);
    tab.store.add(scan('NEW', 1000));
    expect(storage.storedTexts()).toEqual(['NEW']);
  });

  it('keeps history in memory when storage is full', () => {
    const storage = new MemoryStorage();
    storage.full = true;
    const tab = openTab(storage);
    tab.store.add(scan('ONE', 1000));
    tab.store.add(scan('TWO', 2000));
    expect(tab.texts()).toEqual(['TWO', 'ONE']);
  });

  it('merges scans from another tab into history it could not save', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    storage.full = true;
    a.store.add(scan('UNSAVED', 1000));
    storage.full = false;
    openTab(storage).store.add(scan('OTHER TAB', 2000));

    a.receiveStorageEvent();
    expect(a.texts()).toEqual(['OTHER TAB', 'UNSAVED']);
    expect(storage.storedTexts()).toEqual(['OTHER TAB', 'UNSAVED']);
  });

  it('does not undo a clear made in another tab', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.add(scan('SAVED', 1000));
    storage.full = true;
    a.store.add(scan('UNSAVED', 2000));
    storage.full = false;

    openTab(storage).store.clear();
    a.receiveStorageEvent();
    expect(a.texts()).toEqual([]);
    expect(storage.stored()).toEqual({ generation: 1, results: [] });
  });

  it('lets a clear win over scans from a tab that had not seen it', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.add(scan('OLD', 1000));
    storage.full = true;
    a.store.clear();
    storage.full = false;
    openTab(storage).store.add(scan('CONCURRENT', 3000));

    a.receiveStorageEvent();
    expect(a.texts()).toEqual([]);
    expect(storage.stored()).toEqual({ generation: 1, results: [] });
  });

  it('never hides a scan just added, whatever the system clock says', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2030-01-01'));
    const tab = openTab(new MemoryStorage());
    tab.store.clear();
    vi.setSystemTime(Date.parse('2020-01-01'));
    tab.store.add(scan('AFTER CLOCK CORRECTION', Date.now()));
    expect(tab.texts()).toEqual(['AFTER CLOCK CORRECTION']);
  });

  it('adopts changes from other tabs while in sync', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    const listener = vi.fn();
    a.store.subscribe(listener);
    openTab(storage).store.add(scan('REMOTE', 1000));
    a.receiveStorageEvent();
    expect(a.texts()).toEqual(['REMOTE']);
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({ text: 'REMOTE' })]);
  });

  it('caps history at MAX_RESULTS', () => {
    const tab = openTab(new MemoryStorage());
    for (let i = 1; i <= MAX_RESULTS + 5; i++) tab.store.add(scan(`#${i}`, i));
    expect(tab.store.results).toHaveLength(MAX_RESULTS);
    expect(tab.texts()[0]).toBe(`#${MAX_RESULTS + 5}`);
  });

  it('stops listening to other tabs after dispose', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.dispose();
    openTab(storage).store.add(scan('REMOTE', 1000));
    a.receiveStorageEvent();
    expect(a.texts()).toEqual([]);
  });
});
