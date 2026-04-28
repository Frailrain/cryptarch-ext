// Brief #14.4 — inline expand panel. Renders the per-column display model
// produced by buildDropPerkDisplayModel. Contains zero direct visual logic:
// every classification (rolled? tagged?) was decided upstream by the pure
// helpers in @/core/wishlists/{perk-visual-state,drop-display-model}.
//
// Container uses overflow-x:hidden + overflow-y:visible so icons truncate
// horizontally when the row is too wide while tooltips that pop above the
// icon row aren't clipped.

import { useEffect, useState } from 'react';
import type {
  DropFeedEntry,
  TierLetter,
  WeaponFilterConfig,
  WishlistMatch,
} from '@/shared/types';
import {
  requestPerkPool,
  type WeaponPerkPoolSnapshot,
} from '@/adapters/perk-pool-messages';
import { getItem, onKeyChanged } from '@/adapters/storage';
import type { ManifestProgress } from '@/core/bungie/manifest';
import {
  buildDropPerkDisplayModel,
  voltronConfirmedFromMatches,
  type ExpandedPerk,
  type PerkColumnDisplayModel,
} from '@/core/wishlists/drop-display-model';
import { loadWeaponFilterConfig } from '@/core/storage/scoring-config';
import { PerkIcon } from './PerkIcon';
import { ThumbsUp } from './ThumbsUp';

// Voltron-family source ids for partitioning the wishlist note section
// when voltronConfirmation is on. Mirrors matcher.ts but kept local — the
// page side doesn't need a shared constant for two ids.
const VOLTRON_FAMILY_IDS = new Set(['voltron', 'choosy-voltron']);

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
  // Brief #20: live-subscribed voltronConfirmation toggle. Toggling off in
  // the Weapons tab restores the parallel-source rendering immediately
  // even on entries captured while it was on.
  const [voltronConfirmation, setVoltronConfirmation] = useState<boolean>(
    () => loadWeaponFilterConfig().voltronConfirmation,
  );
  useEffect(() => {
    return onKeyChanged<WeaponFilterConfig>('weaponFilterConfig', (v) => {
      if (v) setVoltronConfirmation(v.voltronConfirmation);
    });
  }, []);

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

      {/* Brief #20: when voltronConfirmation is on AND any Voltron-family
          match flags confirmsCharles, render two stacked sections —
          primary wishlist matches at full weight, then a subtle "Voltron
          community keepers also flagged this roll" annotation. Otherwise
          all matches dedupe into the original combined section. */}
      {/* Brief #21: notification-only matches (custom URLs) never render
          in the wishlist note section — they're alert signals, not curator
          quality. Filtered here before any visual logic considers them. */}
      <WishlistNoteSection
        matches={(entry.wishlistMatches ?? []).filter(
          (m) => m.notificationOnly !== true,
        )}
        voltronConfirmation={voltronConfirmation}
      />

      {showVersionDisclaimer && (
        <div className="text-[10px] text-text-muted pt-1">
          Captured against manifest v{entry.manifestVersion}. Current sandbox may differ.
        </div>
      )}
    </div>
  );
}

function WishlistNoteSection({
  matches,
  voltronConfirmation,
}: {
  matches: WishlistMatch[];
  voltronConfirmation: boolean;
}) {
  if (matches.length === 0) return null;

  const confirmed =
    voltronConfirmation && voltronConfirmedFromMatches(matches);
  if (!confirmed) {
    return <NoteGroupList matches={matches} />;
  }

  const primary = matches.filter(
    (m) => !VOLTRON_FAMILY_IDS.has(m.sourceId) || m.confirmsCharles !== true,
  );
  const voltron = matches.filter(
    (m) => VOLTRON_FAMILY_IDS.has(m.sourceId) && m.confirmsCharles === true,
  );

  return (
    <>
      {primary.length > 0 && <NoteGroupList matches={primary} />}
      {voltron.length > 0 && (
        <div className="border-l-2 border-rahool-blue/40 pl-3 mt-2 space-y-1">
          <div className="text-[11px] font-medium text-text-muted flex items-center gap-1.5">
            <ThumbsUp size={11} className="text-rahool-blue/80" />
            Voltron community keepers also flagged this roll
          </div>
          {dedupeMatchesByNote(voltron).map((group) => (
            <div key={group.sourceNames.join('|')} className="text-xs text-text-muted">
              <span className="text-rahool-blue/70">{group.sourceNames.join(' · ')}</span>
              {group.note && <span className="ml-2 italic">{group.note}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NoteGroupList({ matches }: { matches: WishlistMatch[] }) {
  return (
    <div className="space-y-1 pt-2 border-t border-bg-border/30">
      {dedupeMatchesByNote(matches).map((group) => (
        <div key={group.sourceNames.join('|')} className="text-xs text-text-muted">
          <span className="text-rahool-blue">{group.sourceNames.join(' · ')}</span>
          {group.tier && (
            <span className="ml-2 text-[10px] uppercase">Tier {group.tier}</span>
          )}
          {group.note && <span className="ml-2 italic">{group.note}</span>}
        </div>
      ))}
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
          // Brief #21 follow-up: dropped overflowX:hidden + overflowY:visible
          // — that combo hits a CSS spec quirk (one-axis clipping forces the
          // other axis to clip too in most browsers) and was hiding the
          // PerkTooltip popups. Rows now use natural width; with the dedupe
          // and enhanced-perk filtering from #14.5/#14.6, columns rarely have
          // more than 10-14 plugs and don't need clipping.
          flexWrap: 'nowrap',
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
