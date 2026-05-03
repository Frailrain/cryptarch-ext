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
  migrateWishlistsFromChromeStorage,
  saveWishlistMetadata,
  saveWishlists,
} from '@/core/storage/scoring-config';
import { ensureLoaded } from '@/adapters/storage';
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
 * Hydrates the in-memory cache Map from IndexedDB. Must be called after
 * `ensureLoaded()` has resolved (the migration helper reads chrome.storage
 * via the sync adapter). Idempotent within a worker wake; the per-wake
 * `hydrated` flag short-circuits subsequent calls.
 *
 * Brief #24: includes one-shot migration from chrome.storage.local. If the
 * legacy `cryptarch:wishlists` key still exists, we copy it to IDB and clear
 * the chrome.storage entry. Subsequent SW wakes find an empty legacy key and
 * skip the migration (idempotent).
 *
 * Graceful empty-cache: if neither IDB nor legacy storage has anything (first
 * install, cleared storage, corrupt blob), the Map stays empty and matcher
 * calls return zero matches. The fetch layer populates it on the first refresh.
 */
export async function hydrateWishlistCache(): Promise<void> {
  if (hydrated) return;
  cache.clear();
  status.clear();
  let stored: ImportedWishList[] = [];
  try {
    // Brief #24: migration first. If chrome.storage.local still has the legacy
    // wishlists key, this returns it and copies into IDB. Otherwise null and
    // we fall through to the IDB read.
    const migrated = await migrateWishlistsFromChromeStorage();
    stored = migrated ?? (await loadWishlists());
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

// Brief #12.5 Part D: persist-batching. setFetchSuccess used to call
// persistCache() per source; a 4-source refresh wrote the full ~60 MB array
// 4 times (each progressively larger). Wrapping refreshWishlists in
// beginPersistBatch / endPersistBatch defers writes until the batch closes,
// turning N writes into 1.
let persistBatchDepth = 0;
let persistBatchDirty = false;

export function beginPersistBatch(): void {
  persistBatchDepth += 1;
}

export function endPersistBatch(): void {
  persistBatchDepth = Math.max(0, persistBatchDepth - 1);
  if (persistBatchDepth === 0 && persistBatchDirty) {
    persistBatchDirty = false;
    void persistCache();
  }
}

function schedulePersist(): void {
  if (persistBatchDepth > 0) {
    persistBatchDirty = true;
    return;
  }
  void persistCache();
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
  schedulePersist();
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
  schedulePersist();
}

async function persistCache(): Promise<void> {
  await saveWishlists(Array.from(cache.values()));
}

// Brief #24: the cross-context onChanged sync listener that previously lived
// here is gone. With wishlists moved to IndexedDB (which doesn't broadcast),
// the SW is the sole writer and reader. There's no other context to stay in
// sync with — the dashboard talks to the SW via message handlers
// (wishlist-messages.ts) and reads the small wishlistMetadata key for display.
// Same-context writes are already handled by setFetchSuccess updating both
// the Map and the persistence layer in lockstep.
