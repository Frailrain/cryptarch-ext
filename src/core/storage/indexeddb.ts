// IndexedDB wrapper for the manifest cache (and, in Session 2, the drop log).
// Service workers support IndexedDB with the same API as pages. The DB handle
// is lazily opened and cached within the worker's lifetime; a fresh handle
// is re-acquired after the worker goes to sleep and wakes up.

const DB_NAME = 'cryptarch';
// Bumped to 2 in Brief #14 Part C to add the perkPool store.
// Bumped to 3 in Brief #25 to add per-entry manifest stores.
// Bumped to 4 in Brief #26 to add the wishlists store. The previous chrome.storage.local
// `cryptarch:wishlists` key was 288 MB+ in production and dominated process
// memory through Chrome's storage backend (in-process cache + IPC clones on
// every write). Per-source IDB records eliminate the giant blob.
const DB_VERSION = 4;

export const STORES = {
  manifest: 'manifest',
  dropLog: 'drop-log',
  // Brief #14 Part C: persistent tier of the perk-pool cache, keyed by
  // `${manifestVersion}:${weaponHash}`. Survives browser restarts so a user's
  // second-ever click on the same weapon is instant even after Chrome cleared
  // chrome.storage.session.
  perkPool: 'perk-pool',
  // Brief #25: per-entry manifest stores. Each item / stat / plug-set
  // definition is one IDB record keyed by hash. lookupItem(hash) is a point
  // query rather than a property lookup on a 30 MB in-memory Record.
  manifestItems: 'manifest-items',
  manifestStats: 'manifest-stats',
  manifestPlugSets: 'manifest-plug-sets',
  // Single-row metadata store: key 'current' → { version, locale, downloadedAt }.
  manifestMeta: 'manifest-meta',
  // Brief #26: per-source wishlist store. Key = source id (e.g. 'voltron',
  // 'charles-aegis-tiered'); value = full ImportedWishList. Replaces the
  // monolithic `cryptarch:wishlists` array that was hitting chrome.storage.local.
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
      // Brief #25: per-entry manifest stores. Numeric-hash keys for items
      // and stats; numeric-hash keys for plug sets. Out-of-line keys so we
      // can pass the hash directly to put/get without mutating the record.
      if (!db.objectStoreNames.contains(STORES.manifestItems)) {
        db.createObjectStore(STORES.manifestItems);
      }
      if (!db.objectStoreNames.contains(STORES.manifestStats)) {
        db.createObjectStore(STORES.manifestStats);
      }
      if (!db.objectStoreNames.contains(STORES.manifestPlugSets)) {
        db.createObjectStore(STORES.manifestPlugSets);
      }
      if (!db.objectStoreNames.contains(STORES.manifestMeta)) {
        db.createObjectStore(STORES.manifestMeta);
      }
      // Brief #26: per-source wishlist store. Out-of-line string keys
      // (source id) — passed as the second arg to put/get.
      if (!db.objectStoreNames.contains(STORES.wishlists)) {
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

// Brief #25: clear all records in a store. Used during manifest refresh to
// drop the old version's entries before writing the new version.
export async function idbClear(store: StoreName): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Brief #25: bulk write within a single transaction. Each entry is its own
// put() call but they share one transaction, which is dramatically faster
// than awaiting each idbPut individually (one tx per put). Caller provides
// an iterator of [key, value] pairs.
export async function idbBulkPut<T>(
  store: StoreName,
  entries: Iterable<readonly [IDBValidKey, T]>,
): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objStore = tx.objectStore(store);
    let pending = 0;
    let done = false;
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('idbBulkPut transaction aborted'));
    for (const [key, value] of entries) {
      pending += 1;
      const req = objStore.put(value, key);
      req.onsuccess = () => {
        pending -= 1;
        if (done && pending === 0) {
          // tx.oncomplete will resolve us; no-op here.
        }
      };
      req.onerror = () => reject(req.error);
    }
    done = true;
    if (pending === 0) {
      // Empty iterator — the tx will commit immediately with nothing to do.
    }
  });
}

// Brief #25: stream all records of a store through a callback, one at a time.
// Used for "iterate the whole manifest" callers (taxonomy builders, enhanced
// perk map). Avoids loading the entire table into memory.
export async function idbForEach<T>(
  store: StoreName,
  cb: (key: IDBValidKey, value: T) => void,
): Promise<void> {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      try {
        cb(cursor.key, cursor.value as T);
      } catch (err) {
        reject(err);
        return;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
