import type { WishlistSource } from '@/shared/types';
import { parseWishlist } from '@/core/scoring/wishlist-parser';
import {
  getCachedList,
  getFetchStatus,
  setFetchError,
  setFetchPending,
  setFetchSuccess,
} from './cache';

const STALENESS_MS = 24 * 60 * 60 * 1000;

export interface RefreshResult {
  sourceId: string;
  ok: boolean;
  // Present when ok === false. Same string as the persisted FetchStatus.error.
  error?: string;
  // Present when ok === true. Reflects the entry count of the cached list,
  // either freshly fetched or pre-existing if the source was still fresh.
  entryCount?: number;
  // The timestamp the cache thinks of as the source's "last success" after this
  // refresh call returns. For cached-fresh outcomes this is the prior success.
  lastSuccessAt?: number;
  // True when this refresh actually performed a network fetch (vs returning
  // because the cached copy was still within the staleness window).
  fetched: boolean;
}

export interface RefreshOptions {
  /**
   * Bypass the per-source 24h staleness check. Used when the user clicks
   * "Refresh all" in the Wishlists tab, or when the user has just enabled a
   * previously-disabled source and we want their first match to use fresh data.
   */
  force?: boolean;
}

/**
 * Refresh enabled sources in parallel via Promise.allSettled-style independence:
 * one source's failure cannot block the others. Disabled sources are skipped
 * entirely (no fetch, no cache touch).
 *
 * Per-source staleness: a source is considered fresh if its lastSuccessAt is
 * within the last 24h. Failed fetches don't update lastSuccessAt, so a source
 * that errored out yesterday is treated as stale and retried.
 *
 * If the user enables many sources and many are stale, this fires N parallel
 * fetches. Acceptable today; revisit if N grows large or sources start
 * rate-limiting individual users.
 */
export async function refreshWishlists(
  sources: WishlistSource[],
  opts: RefreshOptions = {},
): Promise<RefreshResult[]> {
  const enabled = sources.filter((s) => s.enabled);
  const promises = enabled.map((source) => refreshOne(source, opts));
  return Promise.all(promises);
}

/**
 * Single-source refresh. Exposed so the Wishlists tab can refresh one row on
 * demand without touching the others.
 */
export async function refreshOne(
  source: WishlistSource,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  if (!opts.force && !isStale(source.id)) {
    const cached = getCachedList(source.id);
    const stat = getFetchStatus(source.id);
    return {
      sourceId: source.id,
      ok: true,
      entryCount: cached?.entryCount,
      lastSuccessAt: stat.lastSuccessAt,
      fetched: false,
    };
  }
  return performFetch(source);
}

function isStale(sourceId: string): boolean {
  const stat = getFetchStatus(sourceId);
  if (!stat.lastSuccessAt) return true;
  return Date.now() - stat.lastSuccessAt > STALENESS_MS;
}

async function performFetch(source: WishlistSource): Promise<RefreshResult> {
  const startedAt = Date.now();
  setFetchPending(source.id);
  try {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const list = parseWishlist(text, {
      id: source.id,
      name: source.name,
      sourceUrl: source.url,
    });
    if (list.entryCount === 0) {
      // Treat zero-entry parses as failures — the URL responded 200 but didn't
      // contain a single dimwishlist line. Almost certainly a wrong URL or a
      // moved file rendering as HTML. Don't poison the cache with empty data.
      throw new Error('Fetched body parsed to zero wishlist entries');
    }
    const fetchedAt = Date.now();
    setFetchSuccess(list, fetchedAt);
    return {
      sourceId: source.id,
      ok: true,
      entryCount: list.entryCount,
      lastSuccessAt: fetchedAt,
      fetched: true,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    setFetchError(source.id, errorMessage, startedAt);
    return {
      sourceId: source.id,
      ok: false,
      error: errorMessage,
      lastSuccessAt: getFetchStatus(source.id).lastSuccessAt,
      fetched: true,
    };
  }
}
