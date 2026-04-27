// Brief #14 Part E — page-side client for the SW's perk-pool resolver.
// Settings page deliberately doesn't load the manifest into memory (the
// 30-60 MB footprint is the cause of the freeze patterns we already
// eliminated in Brief #12.5). All perk-pool reads go through the SW, which
// owns the manifest and the tiered cache. The SW returns enriched snapshots
// with names + icon URLs so the page can render directly without any
// manifest lookups of its own.

import { send } from '@/shared/messaging';
import type { WeaponPerkPoolSnapshot } from '@/core/bungie/perk-pool-cache';

interface GetResponse {
  ok: true;
  payload: { snapshot: WeaponPerkPoolSnapshot | null };
}

type ErrorResponse = { ok: false; error?: string };

// Page-side perk name cache. Populated as a side effect whenever
// requestPerkPool succeeds — so the dashboard's idle prewarm, the popup's
// idle prewarm, and the on-click expand fetch all contribute. Lets the
// collapsed-row + popup-row tooltips show real perk names without firing a
// SW message on every hover. Module-scoped → one cache per page context;
// the popup and dashboard each maintain their own (Chrome can't share JS
// memory across extension pages anyway).
const nameCache = new Map<number, string>();

export function getPerkName(hash: number): string | null {
  return nameCache.get(hash) ?? null;
}

// React component subscription. Without this, prewarm responses landing
// after mount populate the cache but no row re-renders, so tooltips stay
// stuck on the hash fallback. usePerkNames() lives in RolledPerkRow.tsx
// and friends; this just notifies them.
const subscribers = new Set<() => void>();
export function subscribePerkNames(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function populateNameCache(snapshot: WeaponPerkPoolSnapshot): void {
  let added = false;
  for (const col of snapshot.columns) {
    for (const plug of col.plugs) {
      if (!nameCache.has(plug.hash)) {
        nameCache.set(plug.hash, plug.name);
        added = true;
      }
    }
  }
  if (added) {
    for (const cb of subscribers) cb();
  }
}

export async function requestPerkPool(
  weaponHash: number,
): Promise<{ ok: true; snapshot: WeaponPerkPoolSnapshot | null } | { ok: false; error: string }> {
  const resp = await send<GetResponse | ErrorResponse>({
    type: 'perkPool:get',
    payload: { weaponHash },
  });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error ?? 'No response from background worker' };
  }
  if (resp.payload.snapshot) {
    populateNameCache(resp.payload.snapshot);
  }
  return { ok: true, snapshot: resp.payload.snapshot };
}

export type { WeaponPerkPoolSnapshot };
