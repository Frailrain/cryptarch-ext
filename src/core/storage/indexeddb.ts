// IndexedDB wrapper for the manifest cache (and, in Session 2, the drop log).
// Service workers support IndexedDB with the same API as pages. The DB handle
// is lazily opened and cached within the worker's lifetime; a fresh handle
// is re-acquired after the worker goes to sleep and wakes up.

const DB_NAME = 'cryptarch';
// Bumped to 2 in Brief #14 Part C to add the perkPool store. Bumped to 3 in
// Brief #24 to add the wishlists store — moves the parsed wishlist payload
// (~30-300 MB) out of chrome.storage.local. chrome.storage.onChanged was
// broadcasting the full payload to every extension page on every write,
// blowing up dashboard V8 heap to 1+ GB. IDB doesn't fire cross-context
// events, so the SW becomes the sole owner. Upgrades are additive — older
// stores survive intact when only new stores are created.
const DB_VERSION = 3;

export const STORES = {
  manifest: 'manifest',
  dropLog: 'drop-log',
  // Brief #14 Part C: persistent tier of the perk-pool cache, keyed by
  // `${manifestVersion}:${weaponHash}`. Survives browser restarts so a user's
  // second-ever click on the same weapon is instant even after Chrome cleared
  // chrome.storage.session.
  perkPool: 'perk-pool',
  // Brief #24: parsed wishlist arrays live here, single-keyed under
  // WISHLISTS_IDB_KEY. SW is the sole reader/writer; pages never touch this
  // store. See comment on DB_VERSION above for why.
  wishlists: 'wishlists',
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
      if (!db.objectStoreNames.contains(STORES.perkPool)) {
        // Plain key/value store — keys are `${manifestVersion}:${weaponHash}`
        // strings, values are WeaponPerkPoolSnapshot objects. No indexes;
        // lookups are point queries by exact key.
        db.createObjectStore(STORES.perkPool);
      }
      if (!db.objectStoreNames.contains(STORES.wishlists)) {
        // Brief #24: single-blob store. The whole ImportedWishList[] lives
        // under one key. Per-source storage would be cleaner long-term but
        // this minimum-scope move out of chrome.storage.local is what kills
        // the dashboard memory leak; record-style refactor can land later.
        db.createObjectStore(STORES.wishlists);
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
