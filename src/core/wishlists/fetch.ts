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

export type ValidationResult =
  | { ok: true; entryCount: number }
  | { ok: false; error: string };

/**
 * Pre-flight validation for user-pasted wishlist URLs. Used by the Wishlists
 * tab when the user clicks "Add" on the custom-source form. Sequential stages
 * with stage-specific error messages so the UI can give actionable feedback
 * rather than a generic "fetch failed."
 *
 * The "zero entries parsed" error is the most likely failure mode in practice —
 * users paste the GitHub page URL (https://github.com/.../blob/...) instead of
 * the raw URL (raw.githubusercontent.com/...). The parser sees an HTML page,
 * matches no dimwishlist lines, and returns an empty list. Error message
 * explicitly hints at this.
 *
 * Does NOT touch the cache — pure validation. Caller decides whether to add
 * the source after a successful result.
 */
export async function validateWishlistUrl(url: string): Promise<ValidationResult> {
  if (!url.startsWith('https://')) {
    return { ok: false, error: 'URL must start with https://' };
  }

  // Stage 1: HEAD pre-check. Best-effort — some servers reject HEAD with 405,
  // in which case we let the GET attempt below decide. Network errors during
  // HEAD also fall through to GET.
  try {
    const headResponse = await fetch(url, { method: 'HEAD' });
    if (headResponse.status !== 405 && !headResponse.ok) {
      return {
        ok: false,
        error: `URL not reachable (HTTP ${headResponse.status})`,
      };
    }
  } catch {
    // Fall through to GET; that error message is more actionable.
  }

  // Stage 2: GET + parse.
  let text: string;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        ok: false,
        error: `Could not download wishlist (HTTP ${response.status})`,
      };
    }
    text = await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not download wishlist: ${msg}` };
  }

  const parsed = await parseWishlist(text, {
    id: 'validate-tmp',
    name: 'validate-tmp',
    sourceUrl: url,
  });
  if (parsed.entryCount === 0) {
    return {
      ok: false,
      error:
        "URL doesn't look like a DIM wishlist. Make sure you're using the raw " +
        "GitHub URL (starts with raw.githubusercontent.com), not the GitHub page URL.",
    };
  }

  return { ok: true, entryCount: parsed.entryCount };
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
    const list = await parseWishlist(text, {
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
