// Cached chrome.storage.local adapter. The service worker dies after 30s of
// inactivity, so state cannot live in module-level variables — it has to be
// rehydrated from chrome.storage on each wake. To keep the rest of the
// codebase's sync getItem/setItem API intact, we hydrate the cache once per
// worker wake (call `ensureLoaded()` at the top of any handler that reads state)
// and write-through to chrome.storage on every setItem.

const PREFIX = 'cryptarch:';

let cache: Record<string, unknown> | null = null;
let loadPromise: Promise<void> | null = null;

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
  void chrome.storage.local.set({ [PREFIX + key]: value });
}

export function removeItem(key: string): void {
  const c = assertLoaded();
  delete c[PREFIX + key];
  void chrome.storage.local.remove(PREFIX + key);
}

// Live-update hook for consumers (options page) that want to re-render when a
// specific key changes. Returns an unsubscribe function.
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
    const newValue = changes[fullKey]?.newValue ?? null;
    if (cache) {
      if (newValue === null || newValue === undefined) {
        delete cache[fullKey];
      } else {
        cache[fullKey] = newValue;
      }
    }
    cb(newValue as T | null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
