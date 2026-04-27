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
  return { ok: true, snapshot: resp.payload.snapshot };
}

export type { WeaponPerkPoolSnapshot };
