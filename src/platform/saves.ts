/**
 * Save slots in IndexedDB: three manual slots plus one autosave slot. Values
 * are SaveFile objects (see saveFormat.ts), stored as plain structured data.
 */
import { STORAGE_PREFIX } from '../config';
import type { SaveFile, SaveMeta } from './saveFormat';

export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export const AUTOSAVE_SLOT = 'autosave';
export type SlotId = (typeof MANUAL_SLOTS)[number] | typeof AUTOSAVE_SLOT;
export const ALL_SLOTS: readonly SlotId[] = [...MANUAL_SLOTS, AUTOSAVE_SLOT];

const DB_NAME = `${STORAGE_PREFIX}-saves`;
const DB_VERSION = 1;
const STORE = 'saves';

export interface SlotSummary {
  slot: SlotId;
  meta: SaveMeta | null;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser does not support saving (no IndexedDB).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the save database.'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const result = await promisify(fn(tx.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Save transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted.'));
  });
  return result;
}

export async function writeSlot(slot: SlotId, save: SaveFile): Promise<void> {
  await withStore('readwrite', (s) => s.put(save, slot));
}

/** Returns the raw stored object; pass it through parseSaveFile before use. */
export async function readSlot(slot: SlotId): Promise<unknown> {
  return (await withStore('readonly', (s) => s.get(slot))) ?? null;
}

export async function deleteSlot(slot: SlotId): Promise<void> {
  await withStore('readwrite', (s) => s.delete(slot));
}

export async function listSlots(): Promise<SlotSummary[]> {
  const out: SlotSummary[] = [];
  for (const slot of ALL_SLOTS) {
    const raw = (await readSlot(slot)) as Partial<SaveFile> | null;
    out.push({ slot, meta: raw?.meta ?? null });
  }
  return out;
}

/** For tests: drop the cached connection. */
export function resetSaveDbConnection(): void {
  dbPromise = null;
}
