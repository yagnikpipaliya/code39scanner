import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RESULTS, ResultsStore, STORAGE_KEY } from '../demo/results-store.js';

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

  stored(): { clearedAt: number; results: { text: string }[] } {
    return JSON.parse(this.items.get(STORAGE_KEY) ?? 'null');
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
    receiveStorageEvent: () =>
      events.dispatchEvent(Object.assign(new Event('storage'), { key: STORAGE_KEY })),
  };
}

const scan = (text: string, timestamp: number) => ({ text, timestamp });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
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

  it('reads history saved by earlier versions (a plain array)', () => {
    const storage = new MemoryStorage();
    storage.items.set(STORAGE_KEY, JSON.stringify([{ id: '1', text: 'LEGACY', timestamp: 5 }]));
    expect(openTab(storage).texts()).toEqual(['LEGACY']);
  });

  it('ignores corrupted data and repairs it on the next write', () => {
    const storage = new MemoryStorage();
    storage.items.set(STORAGE_KEY, '{not json');
    const tab = openTab(storage);
    expect(tab.texts()).toEqual([]);
    tab.store.add(scan('NEW', 1000));
    expect(storage.stored().results.map((r) => r.text)).toEqual(['NEW']);
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
    expect(storage.stored().results.map((r) => r.text)).toEqual(['OTHER TAB', 'UNSAVED']);
  });

  it('does not undo a clear made in another tab', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.add(scan('SAVED', 1000));
    storage.full = true;
    a.store.add(scan('UNSAVED', 2000));
    storage.full = false;

    vi.setSystemTime(3000);
    openTab(storage).store.clear();
    a.receiveStorageEvent();
    expect(a.texts()).toEqual([]);
    expect(storage.stored().results).toEqual([]);
  });

  it('keeps a clear made while storage was full, but not scans made after it', () => {
    const storage = new MemoryStorage();
    const a = openTab(storage);
    a.store.add(scan('OLD', 1000));
    storage.full = true;
    vi.setSystemTime(2000);
    a.store.clear();
    storage.full = false;
    openTab(storage).store.add(scan('NEW', 3000));

    a.receiveStorageEvent();
    expect(a.texts()).toEqual(['NEW']);
    expect(storage.stored().results.map((r) => r.text)).toEqual(['NEW']);
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
