// Page-side client for the SW's wishlist mutation surface. Brief #12.5
// Part D made the dashboard a viewer — nothing in src/settings or src/popup
// should import from src/core/wishlists/{cache,fetch,matcher}, because
// transitively loading those modules in a page context re-introduces the
// 30-second freeze that motivated this refactor (settings-context cache
// machinery treating an empty in-memory map as "everything stale" → full
// re-fetch + re-parse + re-write of every enabled source).
//
// All wishlist mutations (refresh, validate URL, drop source) go through
// the SW via these wrappers. The SW owns in-flight guards, batch persists,
// and writes both the wishlists key (full payload) and wishlistMetadata
// (small derived view the dashboard reads for display).

import { send } from '@/shared/messaging';
import type { WishlistMatch } from '@/shared/types';

export interface RefreshResultLite {
  sourceId: string;
  ok: boolean;
  error?: string;
  entryCount?: number;
  lastSuccessAt?: number;
  fetched: boolean;
}

export type ValidationResult =
  | { ok: true; entryCount: number }
  | { ok: false; error: string };

interface RefreshOneResponse {
  ok: true;
  payload: { result: RefreshResultLite };
}

interface ValidateUrlResponse {
  ok: true;
  payload: ValidationResult;
}

interface OkOnlyResponse {
  ok: true;
}

type ErrorResponse = { ok: false; error?: string };

export async function requestRefreshOne(
  sourceId: string,
  force = true,
): Promise<{ ok: true; result: RefreshResultLite } | { ok: false; error: string }> {
  const resp = await send<RefreshOneResponse | ErrorResponse>({
    type: 'wishlists:refreshOne',
    payload: { sourceId, force },
  });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error ?? 'No response from background worker' };
  }
  return { ok: true, result: resp.payload.result };
}

export async function requestValidateUrl(url: string): Promise<ValidationResult> {
  const resp = await send<ValidateUrlResponse | ErrorResponse>({
    type: 'wishlists:validateUrl',
    payload: { url },
  });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error ?? 'No response from background worker' };
  }
  return resp.payload;
}

export async function requestDropSource(
  sourceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resp = await send<OkOnlyResponse | ErrorResponse>({
    type: 'wishlists:dropSource',
    payload: { sourceId },
  });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error ?? 'No response from background worker' };
  }
  return { ok: true };
}

// Re-export for callers that need the type without depending on shared/types.
export type { WishlistMatch };
