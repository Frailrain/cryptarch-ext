// IndexedDB wrapper for the manifest cache (and, in Session 2, the drop log).
// Service workers support IndexedDB with the same API as pages. The DB handle
// is lazily opened and cached within the worker's lifetime; a fresh handle
// is re-acquired after the worker goes to sleep and wakes up.

const DB_NAME = 'cryptarch';
const DB_VERSION = 1;

export const STORES = {
  manifest: 'manifest',
  dropLog: 'drop-log',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let openPromise: Promise<IDBDatabase> | null = null;

export function idbOpen(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.manifest)) {
        db.createObjectStore(STORES.manifest);
      }
      if (!db.objectStoreNames.contains(STORES.dropLog)) {
        const store = db.createObjectStore(STORES.dropLog, { keyPath: 'instanceId' });
        store.createIndex('detectedAt', 'detectedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
  return openPromise;
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req =
      key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbListKeys(store: StoreName): Promise<IDBValidKey[]> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => resolve(req.result as IDBValidKey[]);
    req.onerror = () => reject(req.error);
  });
}
