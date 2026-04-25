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
  saveWishlists,
} from '@/core/storage/scoring-config';
import { ensureLoaded, onKeyChanged } from '@/adapters/storage';
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
  hydrateWishlistCache();
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
    persistCache();
  }
}

function schedulePersist(): void {
  if (persistBatchDepth > 0) {
    persistBatchDirty = true;
    return;
  }
  persistCache();
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
// Brief #12.5 follow-up: gate this listener to SW context only. cache.ts is
// transitively loaded in the settings page (via WeaponsPanel → fetch.ts →
// cache.ts) and the popup, but neither context ever uses the in-memory cache
// Map — only the SW's matcher does. Without this gate, every wishlists-key
// write (60 MB+ payload from SW background refresh) triggered a pointless
// 60 MB iteration in the settings page context, freezing the dashboard for
// 10-20s when the user opened the Weapons tab. SW global lacks `window`.
//
// Same-context (SW) writes are handled idempotently: setFetchSuccess updates
// the Map then calls persistCache which triggers this listener; the
// importedAt comparison below makes the re-process a no-op since the Map
// already holds the just-written list with the same timestamp.
if (typeof window === 'undefined') {
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
}
