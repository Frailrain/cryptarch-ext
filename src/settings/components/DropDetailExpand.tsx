// Brief #14.4 — inline expand panel. Renders the per-column display model
// produced by buildDropPerkDisplayModel. Contains zero direct visual logic:
// every classification (rolled? tagged?) was decided upstream by the pure
// helpers in @/core/wishlists/{perk-visual-state,drop-display-model}.
//
// Container uses overflow-x:hidden + overflow-y:visible so icons truncate
// horizontally when the row is too wide while tooltips that pop above the
// icon row aren't clipped.

import { useEffect, useState } from 'react';
import type { DropFeedEntry, TierLetter, WishlistMatch } from '@/shared/types';
import {
  requestPerkPool,
  type WeaponPerkPoolSnapshot,
} from '@/adapters/perk-pool-messages';
import { getItem } from '@/adapters/storage';
import type { ManifestProgress } from '@/core/bungie/manifest';
import {
  buildDropPerkDisplayModel,
  type ExpandedPerk,
  type PerkColumnDisplayModel,
} from '@/core/wishlists/drop-display-model';
import { PerkIcon } from './PerkIcon';

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
  // The "no snapshot" outcome — weapon has no random-roll columns (some
  // exotics, ghost shells), or manifest can't resolve the hash.
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

export function DropDetailExpand({ entry }: { entry: DropFeedEntry }) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    if (entry.itemHash === undefined) {
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
        <ExpandedColumns
          entry={entry}
          snapshot={state.snapshot}
          wishlistMatches={entry.wishlistMatches ?? []}
        />
      )}

      {entry.wishlistMatches && entry.wishlistMatches.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-bg-border/30">
          {dedupeMatchesByNote(entry.wishlistMatches).map((group) => (
            <div key={group.sourceNames.join('|')} className="text-xs text-text-muted">
              <span className="text-rahool-blue">{group.sourceNames.join(' · ')}</span>
              {group.tier && (
                <span className="ml-2 text-[10px] uppercase">Tier {group.tier}</span>
              )}
              {group.note && <span className="ml-2 italic">{group.note}</span>}
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

function ExpandedColumns({
  entry,
  snapshot,
  wishlistMatches,
}: {
  entry: DropFeedEntry;
  snapshot: WeaponPerkPoolSnapshot;
  wishlistMatches: WishlistMatch[];
}) {
  // Identity normalize for now — enhanced↔base resolution happens at capture
  // time in the controller (entry hashes are already canonicalized) and at
  // resolve time for plug pool data. If a future bug surfaces a normalization
  // mismatch on the page side, swap this for a real normalize function.
  const model = buildDropPerkDisplayModel({
    entry,
    snapshot,
    wishlistMatches,
    normalize: (h) => h,
  });
  return (
    <div className="space-y-2">
      {model.map((col) => (
        <ExpandedColumnRow key={col.socketIndex} column={col} />
      ))}
    </div>
  );
}

function ExpandedColumnRow({ column }: { column: PerkColumnDisplayModel }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-[0.06em] text-text-muted">
        {column.label}
      </div>
      <div
        className="flex items-center"
        style={{
          gap: 4,
          flexWrap: 'nowrap',
          // overflowX hides icons that exceed the row width — priority order
          // means filler clips first. overflowY stays visible so PerkTooltip
          // popups (positioned above the icon) aren't clipped.
          overflowX: 'hidden',
          overflowY: 'visible',
        }}
      >
        {column.expandedPerks.map((p) => (
          <ExpandedPerkIcon key={p.state.perkHash} perk={p} />
        ))}
      </div>
    </div>
  );
}

function ExpandedPerkIcon({ perk }: { perk: ExpandedPerk }) {
  const tooltip = perk.description
    ? `${perk.name}\n\n${perk.description}`
    : perk.name;
  return <PerkIcon state={perk.state} iconUrl={perk.iconUrl} size={26} tooltipText={tooltip} />;
}

// Group matches by their cleaned note text. Voltron + Choosy Voltron typically
// share the same note for the same roll; collapse to one row per unique note
// with both source names listed.
const NOTE_MAX_CHARS = 220;
function dedupeMatchesByNote(matches: WishlistMatch[]) {
  const groups = new Map<
    string,
    { note: string | null; sourceNames: string[]; tier: TierLetter | undefined }
  >();
  for (const m of matches) {
    const cleaned = cleanNote(m.notes);
    const key = cleaned ?? `__no_note__:${m.sourceId}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.sourceNames.includes(m.sourceName)) {
        existing.sourceNames.push(m.sourceName);
      }
      if (m.weaponTier && (!existing.tier || tierBeats(m.weaponTier, existing.tier))) {
        existing.tier = m.weaponTier;
      }
    } else {
      groups.set(key, {
        note: cleaned,
        sourceNames: [m.sourceName],
        tier: m.weaponTier,
      });
    }
  }
  return Array.from(groups.values());
}

function cleanNote(note: string | undefined): string | null {
  if (!note) return null;
  const stripped = note.split('|tags:')[0].trim();
  if (!stripped) return null;
  if (stripped.length <= NOTE_MAX_CHARS) return stripped;
  return stripped.slice(0, NOTE_MAX_CHARS).trimEnd() + '…';
}

const TIER_ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];
function tierBeats(candidate: TierLetter, current: TierLetter): boolean {
  return TIER_ORDER.indexOf(candidate) < TIER_ORDER.indexOf(current);
}
