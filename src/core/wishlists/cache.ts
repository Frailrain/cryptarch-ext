import type { ImportedWishList } from '@/core/scoring/types';
import {
  loadWishlists,
  loadWishlistSources,
  saveWishlists,
} from '@/core/storage/scoring-config';
import { ensureLoaded, onKeyChanged } from '@/adapters/storage';
import { refreshWishlists } from './fetch';

// In-memory cache of parsed wishlists, keyed by source id (matches WishlistSource.id
// and ImportedWishList.id). Service workers die after ~30s of inactivity, so this
// Map is empty on every cold start — `hydrateWishlistCache()` rebuilds it from the
// persisted `wishlists` storage key, and the fetch layer keeps it warm thereafter.
//
// Persistence model: parsed entries live under the existing `wishlists` storage key
// (an ImportedWishList[] array). The cache module reads and writes that key. Avoiding
// re-download of large wishlists (~25 MB Voltron) on every wake.
const cache = new Map<string, ImportedWishList>();

export type FetchState = 'idle' | 'fetching' | 'ok' | 'error';

export interface FetchStatus {
  state: FetchState;
  // Ticks ONLY on successful fetch. Failed fetches leave this untouched so the
  // next refresh retries immediately rather than waiting 24h. Surfaced to UI as
  // "last updated."
  lastSuccessAt?: number;
  // Updated on every fetch attempt regardless of outcome. Diagnostic only.
  lastAttemptAt?: number;
  // Present when state === 'error'. Human-readable.
  error?: string;
  // Cached so the UI doesn't have to reach into the cache to display counts.
  entryCount?: number;
}

const status = new Map<string, FetchStatus>();

let hydrated = false;
let backgroundRefreshKicked = false;

/**
 * Sync cache hydration. Must be called after `ensureLoaded()` has resolved —
 * uses the storage adapter's sync `getItem` under the hood. Idempotent within a
 * worker wake; the per-wake `hydrated` flag short-circuits subsequent calls.
 *
 * Graceful empty-cache: if storage holds nothing for the wishlists key (first
 * install, cleared storage, corrupt blob), the Map stays empty and matcher
 * calls return zero matches. The fetch layer populates it on the first refresh.
 */
export function hydrateWishlistCache(): void {
  if (hydrated) return;
  cache.clear();
  status.clear();
  let stored: ImportedWishList[] = [];
  try {
    stored = loadWishlists();
  } catch {
    stored = [];
  }
  for (const list of stored) {
    if (!list || typeof list.id !== 'string') continue;
    cache.set(list.id, list);
    // Derive lastSuccessAt from the list's stored importedAt — a list in storage
    // was, by construction, successfully fetched at some point. Saves us a
    // separate status-persistence layer for Brief #11.
    status.set(list.id, {
      state: 'ok',
      lastSuccessAt: list.importedAt,
      lastAttemptAt: list.importedAt,
      entryCount: list.entryCount,
    });
  }
  hydrated = true;
}

/**
 * Async entry point used by the controller: ensures storage is loaded, then
 * hydrates the wishlist cache. The first call per worker wake also fires a
 * fire-and-forget background refresh of all enabled sources.
 *
 * cache.ts ↔ fetch.ts are circular at the static-import level (fetch.ts pulls
 * cache.ts's setFetchSuccess et al., cache.ts pulls fetch.ts's refreshWishlists
 * here). ESM circular imports work because neither module calls the other at
 * module-load time — only inside function bodies that run later.
 *
 * Brief #12.5 Part D: previously this used `await import(...)` to defer the
 * load. That triggered Vite's __vitePreload helper which tries to inject
 * <link rel="modulepreload"> into document.head — fine in browser contexts,
 * but the SW has no `document`, so cache warm-up at SW boot threw
 * ReferenceError and the cache stayed cold until the next message handler
 * explicitly awaited ensureWishlistCacheReady. Static imports skip the
 * preload helper entirely.
 */
export async function ensureWishlistCacheReady(): Promise<void> {
  await ensureLoaded();
  hydrateWishlistCache();
  if (!backgroundRefreshKicked) {
    backgroundRefreshKicked = true;
    void refreshWishlists(loadWishlistSources()).catch(() => {
      // Errors are tracked per-source in the status map; refreshWishlists
      // itself never throws. The catch here is defense-in-depth.
    });
  }
}

export function getCachedList(sourceId: string): ImportedWishList | undefined {
  return cache.get(sourceId);
}

export function getAllCachedLists(): ImportedWishList[] {
  return Array.from(cache.values());
}

export function getFetchStatus(sourceId: string): FetchStatus {
  return status.get(sourceId) ?? { state: 'idle' };
}

export function getAllStatuses(): Map<string, FetchStatus> {
  return new Map(status);
}

export function setFetchPending(sourceId: string): void {
  const prev = status.get(sourceId) ?? { state: 'idle' };
  status.set(sourceId, { ...prev, state: 'fetching' });
}

export function setFetchSuccess(list: ImportedWishList, fetchedAt: number): void {
  cache.set(list.id, list);
  status.set(list.id, {
    state: 'ok',
    lastSuccessAt: fetchedAt,
    lastAttemptAt: fetchedAt,
    entryCount: list.entryCount,
  });
  persistCache();
}

export function setFetchError(
  sourceId: string,
  errorMessage: string,
  attemptedAt: number,
): void {
  const prev = status.get(sourceId) ?? { state: 'idle' };
  status.set(sourceId, {
    ...prev,
    state: 'error',
    error: errorMessage,
    lastAttemptAt: attemptedAt,
    // lastSuccessAt intentionally preserved — failed fetches don't reset it.
  });
}

export function removeFromCache(sourceId: string): void {
  cache.delete(sourceId);
  status.delete(sourceId);
  persistCache();
}

function persistCache(): void {
  saveWishlists(Array.from(cache.values()));
}

// Cross-context cache sync: the storage adapter's onChanged listener already
// keeps the raw key/value cache in sync, but our wishlist Map needs its own
// hook because it derives from a single key. Without this, a settings-page
// refresh of a source wouldn't be visible to the SW's matcher until the next
// worker wake — which broke the in-page Wishlist matcher test panel and meant
// up to 30s of stale scoring after any user-initiated config change.
//
// Same-context writes are handled idempotently: setFetchSuccess updates the Map
// then calls persistCache which triggers this listener; the importedAt
// comparison below makes the re-process a no-op since the Map already holds the
// just-written list with the same timestamp.
onKeyChanged<ImportedWishList[]>('wishlists', (newValue) => {
  // Don't gate on `hydrated`. If the SW wakes for a handler that didn't go
  // through ensureWishlistCacheReady, this listener serves as the cold-path
  // initializer too. `hydrated` gets set below so subsequent calls to
  // hydrateWishlistCache are no-ops.
  const incoming = new Map<string, ImportedWishList>();
  if (newValue) {
    for (const list of newValue) {
      if (list && typeof list.id === 'string') incoming.set(list.id, list);
    }
  }
  // Drop entries that disappeared from storage (another context deleted a source).
  for (const id of Array.from(cache.keys())) {
    if (!incoming.has(id)) {
      cache.delete(id);
      status.delete(id);
    }
  }
  // Add or refresh entries that are new or have a newer importedAt.
  for (const [id, list] of incoming) {
    const existing = cache.get(id);
    if (existing && existing.importedAt === list.importedAt) continue;
    cache.set(id, list);
    const prev = status.get(id);
    // Don't clobber an in-flight 'fetching' state; that context's own
    // setFetchSuccess will land the final state.
    if (!prev || prev.state !== 'fetching') {
      status.set(id, {
        state: 'ok',
        lastSuccessAt: list.importedAt,
        lastAttemptAt: list.importedAt,
        entryCount: list.entryCount,
      });
    }
  }
  // Mark hydrated so subsequent hydrateWishlistCache calls short-circuit
  // instead of re-reading from storage redundantly.
  hydrated = true;
});
