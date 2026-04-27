// Brief #14 Part E — inline expand panel that renders below a drop row when
// the user clicks it. Shows the per-column perk pool with two annotations:
// the rolled perk gets a colored border, and any wishlist-tagged perks get
// the same opacity treatment Part B added to the collapsed row icons.
//
// The expand panel never renders without entry.itemHash (DropLogPanel guards
// the click); inside, it fetches the enriched snapshot lazily and shows a
// skeleton until it lands. The SW's tiered cache means second-and-later
// clicks for the same weapon return instantly.

import { useEffect, useState } from 'react';
import type { DropFeedEntry } from '@/shared/types';
import {
  requestPerkPool,
  type WeaponPerkPoolSnapshot,
} from '@/adapters/perk-pool-messages';
import { getItem } from '@/adapters/storage';
import type { ManifestProgress } from '@/core/bungie/manifest';

// The dashboard already keeps `manifest.progress` warm in its storage subset
// (see settings/main.tsx). When stage is 'done', version is the live one.
function currentManifestVersion(): string | null {
  const p = getItem<ManifestProgress>('manifest.progress');
  if (!p || p.stage !== 'done') return null;
  return p.version;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: WeaponPerkPoolSnapshot }
  // The "no snapshot" outcome — weapon has no random-roll columns (e.g. some
  // exotics, ghost shells), or manifest can't resolve the hash. Distinguished
  // from 'error' so we can show a friendlier message.
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

export function DropDetailExpand({ entry }: { entry: DropFeedEntry }) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    if (entry.itemHash === undefined) {
      // Should never reach here — caller guards. Defensive fallback.
      setState({ kind: 'no-data' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    void requestPerkPool(entry.itemHash).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setState({ kind: 'error', message: res.error });
        return;
      }
      if (!res.snapshot) {
        setState({ kind: 'no-data' });
        return;
      }
      setState({ kind: 'ready', snapshot: res.snapshot });
    });
    return () => {
      cancelled = true;
    };
  }, [entry.itemHash]);

  // Cross-reference rolled + tagged hashes against each plug. Both arrays
  // are canonicalized at capture time (Brief #14 Part B), so set-membership
  // works directly without enhanced→base resolution here.
  const rolledHashes = new Set(entry.perkHashes ?? []);
  const taggedHashes = new Set<number>();
  for (const m of entry.wishlistMatches ?? []) {
    for (const h of m.taggedPerkHashes ?? []) taggedHashes.add(h);
  }

  const currentVersion = currentManifestVersion();
  const showVersionDisclaimer =
    entry.manifestVersion !== undefined &&
    currentVersion !== null &&
    entry.manifestVersion !== currentVersion;

  return (
    <div className="border-t border-bg-border/50 mt-2.5 pt-3 px-2 pb-2 space-y-3">
      {state.kind === 'loading' && (
        <div className="text-xs text-text-muted">Loading perk details…</div>
      )}

      {state.kind === 'no-data' && (
        <div className="text-xs text-text-muted">
          No random-roll perk pool for this item.
        </div>
      )}

      {state.kind === 'error' && (
        <div className="text-xs text-red-400">
          Couldn&apos;t load perk details: {state.message}
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="space-y-2">
          {state.snapshot.columns.map((col) => (
            <PerkColumn
              key={col.socketIndex}
              column={col}
              rolledHashes={rolledHashes}
              taggedHashes={taggedHashes}
            />
          ))}
        </div>
      )}

      {entry.wishlistMatches && entry.wishlistMatches.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-bg-border/30">
          {entry.wishlistMatches.map((m) => (
            <div key={m.sourceId} className="text-xs text-text-muted">
              <span className="text-rahool-blue">{m.sourceName}</span>
              {m.weaponTier && (
                <span className="ml-2 text-[10px] uppercase">
                  Tier {m.weaponTier}
                </span>
              )}
              {m.notes && <span className="ml-2 italic">{m.notes}</span>}
            </div>
          ))}
        </div>
      )}

      {showVersionDisclaimer && (
        <div className="text-[10px] text-text-muted pt-1">
          Captured against manifest v{entry.manifestVersion}. Current sandbox may differ.
        </div>
      )}
    </div>
  );
}

function PerkColumn({
  column,
  rolledHashes,
  taggedHashes,
}: {
  column: WeaponPerkPoolSnapshot['columns'][number];
  rolledHashes: Set<number>;
  taggedHashes: Set<number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {column.plugs.map((plug) => {
        const rolled = rolledHashes.has(plug.hash);
        const tagged = taggedHashes.has(plug.hash);
        // Border highlights what actually dropped on this roll. Opacity
        // separates wishlist-flagged perks (full) from the rest of the
        // pool (50%) — same visual rule as the collapsed row.
        const borderClass = rolled
          ? 'border-grade-s ring-2 ring-grade-s/40'
          : 'border-bg-border/60';
        const opacityClass = tagged || rolled ? '' : 'opacity-50';
        return (
          <img
            key={plug.hash}
            src={plug.iconUrl}
            alt={plug.name}
            title={plug.name}
            className={`w-7 h-7 rounded border ${borderClass} ${opacityClass}`}
          />
        );
      })}
    </div>
  );
}
