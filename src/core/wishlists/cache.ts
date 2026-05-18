// SW-ONLY MODULE. Do not import from extension page contexts (popup, options).
// The in-memory cache Map is only consumed by the matcher, which runs in the
// service worker. The dashboard reads wishlistMetadata via a separate small
// storage key; manual refreshes go through the SW message handler. See
// src/adapters/wishlist-messages.ts for the page-side client.
//
// Loading this module in a page context would re-introduce the Brief #12.5
// regression where the dashboard accidentally became a second backend
// pipeline (re-fetching all enabled wishlists on Weapons-tab open).

import type { ImportedWishList } from '@/core/scoring/types';
import type { WishlistMetadata } from '@/shared/types';
import {
  loadWishlistMetadata,
  loadWishlists,
  loadWishlistSources,
  saveWishlistMetadata,
} from '@/core/storage/scoring-config';
import { ensureLoaded, removeItem } from '@/adapters/storage';
import {
  STORES,
  idbBulkPut,
  idbDelete,
  idbForEach,
  idbPut,
} from '@/core/storage/indexeddb';
import { logJson, error as logError } from '@/adapters/logger';
import { refreshWishlists } from './fetch';

if (typeof window !== 'undefined') {
  console.error(
    '[cryptarch] cache.ts loaded in a non-SW context. The wishlist cache + ' +
      'fetch machinery is SW-only. Page contexts should use the message client ' +
      '(src/adapters/wishlist-messages.ts) and read wishlistMetadata for display.',
  );
}

// In-memory cache of parsed wishlists, keyed by source id (matches WishlistSource.id
// and ImportedWishList.id). Service workers die after ~30s of inactivity, so this
// Map is empty on every cold start — `hydrateWishlistCache()` rebuilds it from IDB
// (per-source records), and the fetch layer keeps it warm thereafter.
//
// Brief #26 persistence model: each parsed wishlist is its own record in the IDB
// `wishlists` store, keyed by source id. Pre-#26 the whole collection lived under
// the `cryptarch:wishlists` chrome.storage.local key — a single ~288 MB blob.
// Chrome's storage backend kept that blob in process memory plus IPC-cloned it on
// every write. Per-source IDB records eliminate both costs (the production heap
// dropped from 841 MB to a fraction of that as soon as that key was deleted).
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
 * Async cache hydration from IDB. Idempotent within a worker wake; the
 * per-wake `hydrated` flag short-circuits subsequent calls. Brief #26 made
 * this async (was sync, backed by chrome.storage.local) — every caller is
 * already inside an async function so the await is invisible.
 *
 * Graceful empty-cache: if IDB holds nothing for the wishlists store (first
 * install, cleared storage), the Map stays empty and matcher calls return
 * zero matches. The fetch layer populates it on the first refresh.
 *
 * One-time legacy migration: if `cryptarch:wishlists` is still in
 * chrome.storage.local from before Brief #26, copy each source's entries
 * into IDB and delete the chrome.storage.local key. The 288 MB blob in
 * production storage is the entire driver behind the 841 MB combined
 * process memory we saw. After this migration runs once, future SW wakes
 * skip the legacy path.
 */
function statusFromList(list: ImportedWishList): FetchStatus {
  return {
    state: 'ok',
    lastSuccessAt: list.importedAt,
    lastAttemptAt: list.importedAt,
    entryCount: list.entryCount,
  };
}

export async function hydrateWishlistCache(): Promise<void> {
  if (hydrated) return;
  cache.clear();
  status.clear();

  // Brief #26 migration step. loadWishlists() reads chrome.storage.local
  // via the storage adapter cache — sync, no IPC round-trip, but the data
  // is only there if `cryptarch:wishlists` hasn't been migrated yet.
  let migrated = false;
  try {
    const legacy = loadWishlists();
    if (legacy.length > 0) {
      const entries: Array<readonly [string, ImportedWishList]> = legacy
        .filter((l) => l && typeof l.id === 'string')
        .map((l) => [l.id, l] as const);
      await idbBulkPut(STORES.wishlists, entries);
      // Drop the legacy key. The storage adapter's onChanged listener
      // will null out `cache[key]` in response, releasing the ~288 MB of
      // parsed entries from the storage adapter's in-memory mirror.
      removeItem('wishlists');
      logJson('wishlist', 'migrated wishlists to IDB', {
        sources: entries.length,
        totalEntries: legacy.reduce((sum, l) => sum + (l?.entryCount ?? 0), 0),
      });
      // Populate cache.Map directly from the legacy data we already have
      // parsed — no need to round-trip through IDB read.
      for (const list of legacy) {
        if (!list || typeof list.id !== 'string') continue;
        cache.set(list.id, list);
        status.set(list.id, statusFromList(list));
      }
      migrated = true;
    }
  } catch (err) {
    logError(
      'wishlist',
      'IDB migration failed; will retry on next SW wake',
      err instanceof Error ? err.message : err,
    );
  }

  // Hydrate from IDB when there was nothing legacy to migrate (steady state
  // after the one-time migration runs).
  if (!migrated) {
    try {
      await idbForEach<ImportedWishList>(STORES.wishlists, (_key, list) => {
        if (!list || typeof list.id !== 'string') return;
        cache.set(list.id, list);
        status.set(list.id, statusFromList(list));
      });
    } catch (err) {
      logError(
        'wishlist',
        'IDB hydrate failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  hydrated = true;
}

/**
 * Hydrate the SW's wishlist cache from storage and derive metadata if missing.
 * Idempotent within a worker wake. Does NOT kick a refresh — separated from
 * kickBackgroundWishlistRefresh so callers can choose: pure read, or read +
 * background fetch.
 *
 * Brief #12.5 Part D: also derives & persists wishlistMetadata on first
 * hydrate of a wake if the metadata key is missing or out-of-sync. SW is the
 * only context that ever writes the metadata key, so this is the canonical
 * upgrade path for users who had wishlists data before metadata existed.
 */
export async function hydrateWishlistCacheForWorker(): Promise<void> {
  await ensureLoaded();
  await hydrateWishlistCache();
  syncMetadataFromCache();
}

/**
 * Fire-and-forget background refresh of all currently-enabled sources.
 * Per-source 24h staleness check inside refreshWishlists short-circuits
 * fresh sources — typically a no-op once the cache is warm. Idempotent
 * within a worker wake.
 *
 * cache.ts ↔ fetch.ts are circular at the static-import level (fetch.ts
 * pulls cache.ts's setFetchSuccess et al., cache.ts pulls fetch.ts's
 * refreshWishlists here). ESM circular imports work because neither module
 * calls the other at module-load time — only inside function bodies.
 */
export function kickBackgroundWishlistRefresh(): void {
  if (backgroundRefreshKicked) return;
  backgroundRefreshKicked = true;
  void refreshWishlists(loadWishlistSources()).catch(() => {
    // Errors are tracked per-source in the status map; refreshWishlists
    // itself never throws. The catch here is defense-in-depth.
  });
}

/**
 * Combined entry point: hydrate then kick. Existing callers keep using this;
 * new callers can pick the lower-level helpers above when they want one
 * without the other (e.g., a manual-refresh message handler that hydrates
 * but uses { force: true } for refresh, bypassing the staleness check).
 */
export async function ensureWishlistCacheReady(): Promise<void> {
  await hydrateWishlistCacheForWorker();
  kickBackgroundWishlistRefresh();
}

// Brief #12.5 Part D: settings page reads wishlistMetadata for display. SW is
// the only writer. On hydrate, if metadata is missing or stale relative to the
// cache, derive and persist. Idempotent — content-equality check skips the
// write when nothing changed.
function syncMetadataFromCache(): void {
  if (cache.size === 0) return;
  const stored = loadWishlistMetadata();
  const derived: WishlistMetadata[] = Array.from(cache.values()).map((l) => ({
    id: l.id,
    name: l.name,
    sourceUrl: l.sourceUrl,
    entryCount: l.entryCount,
    importedAt: l.importedAt,
  }));
  if (metadataMatches(stored, derived)) return;
  saveWishlistMetadata(derived);
}

function metadataMatches(a: WishlistMetadata[], b: WishlistMetadata[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const item of b) {
    const other = byId.get(item.id);
    if (!other) return false;
    if (other.entryCount !== item.entryCount) return false;
    if (other.importedAt !== item.importedAt) return false;
  }
  return true;
}

// Brief #26: the pre-#26 batch machinery (beginPersistBatch / endPersistBatch /
// schedulePersist / persistCache) wrapped chrome.storage.local writes of the
// entire wishlist array — necessary when a 4-source refresh would otherwise
// have written the full ~60 MB blob 4 times. With per-source IDB records,
// each setFetchSuccess writes only its own entry; batching adds no value and
// the exports are gone.

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
  // Brief #26: per-source IDB write. Pre-#26 this scheduled a full-array
  // rewrite to chrome.storage.local — the source of the 288 MB IPC clones.
  void idbPut(STORES.wishlists, list, list.id);
  // Keep wishlistMetadata current so the dashboard's WishlistsPanel sees
  // the new entry count without waiting for the next SW boot.
  syncMetadataFromCache();
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
  // Brief #26: drop the per-source IDB record. With the legacy chrome.storage.local
  // path gone, there's no cross-context onChanged listener to invalidate — the
  // SW is the sole writer of wishlist content, and the dashboard's metadata
  // subscription (wishlistMetadata key, still chrome.storage.local) catches
  // the deletion via syncMetadataFromCache.
  void idbDelete(STORES.wishlists, sourceId);
  syncMetadataFromCache();
}
