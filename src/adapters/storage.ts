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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!cache) return;
  for (const [key, change] of Object.entries(changes)) {
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
