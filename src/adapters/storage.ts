// Cached chrome.storage.local adapter. The service worker dies after 30s of
// inactivity, so state cannot live in module-level variables — it has to be
// rehydrated from chrome.storage on each wake. To keep the rest of the
// codebase's sync getItem/setItem API intact, we hydrate the cache once per
// worker wake (call `ensureLoaded()` at the top of any handler that reads state)
// and write-through to chrome.storage on every setItem.
//
// A global chrome.storage.onChanged listener also keeps the cache in sync with
// writes from OTHER contexts (options page → SW, or vice versa). Without this,
// each context only sees its own writes plus what was on disk at wake time.

const PREFIX = 'cryptarch:';

let cache: Record<string, unknown> | null = null;
let loadPromise: Promise<void> | null = null;
// When set (via ensureLoadedSubset), the onChanged listener and the cache only
// track this subset of fully-prefixed keys. Lets the popup avoid pulling the
// 60 MB+ wishlist payload through onChanged updates it doesn't care about.
let allowedKeys: Set<string> | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!cache) return;
  for (const [key, change] of Object.entries(changes)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (change.newValue === undefined) {
      delete cache[key];
    } else {
      cache[key] = change.newValue;
    }
  }
});

export async function ensureLoaded(): Promise<void> {
  if (cache) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const all = await chrome.storage.local.get(null);
    cache = all;
  })();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

/**
 * Variant of ensureLoaded that only fetches the listed keys. Use from contexts
 * (like the popup) that know exactly which keys they need and want to skip
 * paying the cost of loading huge unrelated values — particularly the parsed
 * wishlists, which can be 60 MB+ combined and otherwise add 5-10 s of cold-load
 * lag to popup boot.
 *
 * Once called, the onChanged listener also restricts itself to these keys, so
 * subsequent writes to unlisted keys (e.g. the SW rewriting wishlists) don't
 * push their payloads into this context's cache either.
 *
 * Pass keys WITHOUT the 'cryptarch:' prefix; the adapter applies it. Calling
 * after ensureLoaded() (or after another ensureLoadedSubset) is a no-op.
 */
export async function ensureLoadedSubset(keys: string[]): Promise<void> {
  if (cache) return;
  if (loadPromise) return loadPromise;
  const fullKeys = keys.map((k) => PREFIX + k);
  allowedKeys = new Set(fullKeys);
  // The chrome.storage.local.get typedef in this @types/chrome version doesn't
  // surface the string-array overload, but the object form (keys with default
  // values) is equivalent and properly typed. Using null defaults so missing
  // keys come back as null rather than the default value being misinterpreted.
  const requestObj: Record<string, null> = {};
  for (const k of fullKeys) requestObj[k] = null;
  loadPromise = (async () => {
    const result = await chrome.storage.local.get(requestObj);
    // Strip out the null defaults that chrome.storage returns for absent keys
    // so getItem('x') returns null (its absent contract) rather than the literal
    // null value, matching ensureLoaded's full-load behavior.
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result ?? {})) {
      if (v !== null) filtered[k] = v;
    }
    cache = filtered;
  })();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function assertLoaded(): Record<string, unknown> {
  if (!cache) {
    throw new Error(
      'storage adapter not hydrated; call ensureLoaded() before sync read/write',
    );
  }
  return cache;
}

export function getItem<T>(key: string): T | null {
  const c = assertLoaded();
  const raw = c[PREFIX + key];
  if (raw === undefined || raw === null) return null;
  return raw as T;
}

export function setItem<T>(key: string, value: T): void {
  const c = assertLoaded();
  c[PREFIX + key] = value;
  // Don't swallow rejections. Quota errors (chrome.storage.local default cap is
  // 10 MB without unlimitedStorage) used to fail silently here — the in-memory
  // adapter cache held the value, the writing context's UI showed it, but
  // chrome.storage.local didn't actually persist anything. Other contexts read
  // empty on boot. Log loudly so any future quota or write failure is visible.
  chrome.storage.local.set({ [PREFIX + key]: value }).catch((err) => {
    console.error(
      `[storage] chrome.storage.local.set failed for ${PREFIX + key}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

export function removeItem(key: string): void {
  const c = assertLoaded();
  delete c[PREFIX + key];
  chrome.storage.local.remove(PREFIX + key).catch((err) => {
    console.error(
      `[storage] chrome.storage.local.remove failed for ${PREFIX + key}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

// Live-update hook for consumers (options page) that want to re-render when a
// specific key changes. The cache is already kept current by the global
// onChanged listener above — this just surfaces the change to the caller.
export function onKeyChanged<T>(
  key: string,
  cb: (newValue: T | null) => void,
): () => void {
  const fullKey = PREFIX + key;
  const listener = (
    changes: { [k: string]: chrome.storage.StorageChange },
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local') return;
    if (!(fullKey in changes)) return;
    cb((changes[fullKey]?.newValue ?? null) as T | null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
