// Brief #14.2 — inline expand panel that renders below a drop row. Each
// random-roll column becomes a single horizontal row of icons in priority
// order, browser-truncated when the row overflows. The visual treatment
// gradient encodes everything — no toggles, no headers between buckets:
//
//   Rolled keeper  (rolled + wishlist-tagged):    26px, blue tint + gold + glow
//   Rolled filler  (rolled + not tagged):         26px, near-black + gold, dim
//   Missed keeper  (tagged + not rolled):         22px, blue tint + faint blue
//   Missed filler  (rest of pool):                18px, near-black, very dim
//
// Priority order (left to right): rolled keepers → rolled filler → missed
// keepers → missed filler. Container uses overflow:hidden, so when the row
// runs out of space the lowest-priority items truncate first. The user always
// sees what they got and what they missed; only the "could have been"
// no-decision-relevance filler ever falls off the right edge.
//
// The expand panel never renders without entry.itemHash (DropLogPanel guards
// the click); inside, it fetches the enriched snapshot lazily and shows a
// skeleton until it lands. The SW's tiered cache means second-and-later
// clicks for the same weapon return instantly.

import { useEffect, useState } from 'react';
import type { DropFeedEntry, TierLetter, WishlistMatch } from '@/shared/types';
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
            <ColumnRow
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

// Group matches by their cleaned note text. Voltron + Choosy Voltron typically
// share the same note for the same roll (Choosy is a curated subset of
// Voltron), so showing both produces a wall of duplicate text. We collapse to
// one row per unique note with both source names listed, and pick whichever
// tier is most-restrictive across the group.
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

// Voltron entries have a `|tags:...` metadata trailer the user shouldn't see.
// Strip it, then truncate the rest to keep the expand view readable.
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

type Plug = WeaponPerkPoolSnapshot['columns'][number]['plugs'][number];
type Treatment = 'rolled-keeper' | 'rolled-filler' | 'missed-keeper' | 'missed-filler';

function ColumnRow({
  column,
  rolledHashes,
  taggedHashes,
}: {
  column: WeaponPerkPoolSnapshot['columns'][number];
  rolledHashes: Set<number>;
  taggedHashes: Set<number>;
}) {
  // Bucket in priority order. Manifest order is preserved within each bucket
  // (no sub-sort — the bucket itself is the sort signal).
  const rolledKeepers: Plug[] = [];
  const rolledFiller: Plug[] = [];
  const missedKeepers: Plug[] = [];
  const missedFiller: Plug[] = [];
  for (const p of column.plugs) {
    const rolled = rolledHashes.has(p.hash);
    const tagged = taggedHashes.has(p.hash);
    if (rolled && tagged) rolledKeepers.push(p);
    else if (rolled) rolledFiller.push(p);
    else if (tagged) missedKeepers.push(p);
    else missedFiller.push(p);
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">
        {column.label}
      </div>
      <div
        className="flex items-center"
        style={{ gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}
      >
        {rolledKeepers.map((p) => (
          <PerkIcon key={p.hash} plug={p} treatment="rolled-keeper" />
        ))}
        {rolledFiller.map((p) => (
          <PerkIcon key={p.hash} plug={p} treatment="rolled-filler" />
        ))}
        {missedKeepers.map((p) => (
          <PerkIcon key={p.hash} plug={p} treatment="missed-keeper" />
        ))}
        {missedFiller.map((p) => (
          <PerkIcon key={p.hash} plug={p} treatment="missed-filler" />
        ))}
      </div>
    </div>
  );
}

const TREATMENT_SIZE: Record<Treatment, number> = {
  'rolled-keeper': 26,
  'rolled-filler': 26,
  'missed-keeper': 22,
  'missed-filler': 18,
};

function PerkIcon({ plug, treatment }: { plug: Plug; treatment: Treatment }) {
  const size = TREATMENT_SIZE[treatment];
  // Spec calls for exact hex/rgba values that don't all line up with Tailwind
  // tokens (gold is rahool-yellow, blue tint is rahool-blue/15, but the glow
  // and 0.5px subtle border need arbitrary CSS). Keep all four treatments
  // co-located here as inline styles to make tweaking the gradient easy.
  let style: React.CSSProperties;
  switch (treatment) {
    case 'rolled-keeper':
      style = {
        width: size,
        height: size,
        border: '2px solid #D4A82C',
        background: 'rgba(127, 179, 213, 0.15)',
        boxShadow: '0 0 4px rgba(212, 168, 44, 0.4)',
        opacity: 1,
      };
      break;
    case 'rolled-filler':
      style = {
        width: size,
        height: size,
        border: '2px solid #D4A82C',
        background: '#1a1a1a',
        opacity: 0.65,
      };
      break;
    case 'missed-keeper':
      style = {
        width: size,
        height: size,
        border: '0.5px solid rgba(127, 179, 213, 0.4)',
        background: 'rgba(127, 179, 213, 0.15)',
      };
      break;
    case 'missed-filler':
      style = {
        width: size,
        height: size,
        background: '#1a1a1a',
        opacity: 0.4,
      };
      break;
  }
  const tooltip = plug.description
    ? `${plug.name}\n\n${plug.description}`
    : plug.name;
  // flex-shrink-0 prevents icon squish under the container's nowrap layout —
  // they truncate (clip) at the right edge instead. The inner img is sized
  // a touch smaller than the slot so the border doesn't crowd the artwork.
  return (
    <span
      title={tooltip}
      className="inline-flex items-center justify-center rounded flex-shrink-0"
      style={style}
    >
      <img
        src={plug.iconUrl}
        alt={plug.name}
        className="rounded"
        style={{ width: size - 4, height: size - 4 }}
      />
    </span>
  );
}
