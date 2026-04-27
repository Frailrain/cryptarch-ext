// Brief #14.4 — display model builder. Joins the three raw data sources
// (DropFeedEntry, WeaponPerkPoolSnapshot, WishlistMatch[]) into per-column
// PerkColumnDisplayModel records that the render layer consumes verbatim.
// All visual classification flows through classifyPerkVisualState here;
// downstream consumers do not compute any classification themselves.
//
// Pure module: no React, no Tailwind, no I/O.

import type { DropFeedEntry, WishlistMatch } from '@/shared/types';
import type { WeaponPerkPoolSnapshot } from '@/core/bungie/perk-pool-cache';
import { classifyPerkVisualState, type PerkVisualState } from './perk-visual-state';

export interface PerkColumnDisplayModel {
  socketIndex: number;
  label: string;
  // The single icon to render in the collapsed/popup row for this column.
  // Currently the equipped perk; selectCollapsedPerk picks tagged-rolled
  // when multiple unlocked options exist, otherwise the first rolled.
  collapsedPerk?: PerkVisualState;
  // Icon URL paired with collapsedPerk. Carried alongside because the
  // PerkVisualState itself only knows about hashes — render needs the
  // actual image source.
  collapsedIconUrl?: string;
  // All plugs in the column's pool, with classification + icon + name.
  // Sorted by priority: rolled+tagged, rolled+untagged, tagged-unrolled,
  // neither. Manifest order is preserved within each priority bucket.
  expandedPerks: ExpandedPerk[];
}

export interface ExpandedPerk {
  state: PerkVisualState;
  iconUrl: string;
  name: string;
  description: string;
}

export function buildDropPerkDisplayModel(args: {
  entry: DropFeedEntry;
  // Optional: collapsed row + popup row render before the snapshot arrives
  // and degrade to entry-only data. When the snapshot lands the same builder
  // produces full per-column data with expandedPerks populated.
  snapshot?: WeaponPerkPoolSnapshot;
  wishlistMatches: WishlistMatch[];
  normalize: (hash: number) => number;
}): PerkColumnDisplayModel[] {
  if (!args.snapshot) {
    return buildSnapshotlessModel(args.entry, args.wishlistMatches, args.normalize);
  }
  const unlockedBySocketIndex = readUnlockedBySocketIndex(args.entry, args.snapshot);
  // Wishlist-tagged hashes are flat across all matches because the wishlist
  // file format doesn't carry per-socket attribution. In practice perks are
  // unique to columns, so a flat set never produces a false positive when
  // tested per-column.
  const taggedHashes: number[] = [];
  for (const m of args.wishlistMatches) {
    for (const h of m.taggedPerkHashes ?? []) taggedHashes.push(h);
  }

  return args.snapshot.columns.map((col) => {
    const unlocked = unlockedBySocketIndex[col.socketIndex] ?? [];
    const expandedPerks: ExpandedPerk[] = col.plugs.map((plug) => ({
      state: classifyPerkVisualState({
        perkHash: plug.hash,
        socketIndex: col.socketIndex,
        unlockedHashesForSocket: unlocked,
        taggedHashesForSocket: taggedHashes,
        normalize: args.normalize,
      }),
      iconUrl: plug.iconUrl,
      name: plug.name,
      description: plug.description,
    }));
    expandedPerks.sort((a, b) => a.state.priority - b.state.priority);

    // For the collapsed row icon, classify the unlocked perks (which are
    // hashes only — no icon URLs in the cache). Match each one back to the
    // snapshot's plug list to recover the icon. selectCollapsedPerk picks
    // the rolled+tagged option when multiple unlocked are available.
    const unlockedAsStates: PerkVisualState[] = unlocked.map((hash) =>
      classifyPerkVisualState({
        perkHash: hash,
        socketIndex: col.socketIndex,
        unlockedHashesForSocket: unlocked,
        taggedHashesForSocket: taggedHashes,
        normalize: args.normalize,
      }),
    );
    const collapsedPerk = selectCollapsedPerk(unlockedAsStates);
    let collapsedIconUrl: string | undefined;
    if (collapsedPerk) {
      const matchPlug = col.plugs.find(
        (p) => args.normalize(p.hash) === collapsedPerk.normalizedHash,
      );
      collapsedIconUrl = matchPlug?.iconUrl;
    }

    return {
      socketIndex: col.socketIndex,
      label: col.label,
      collapsedPerk,
      collapsedIconUrl,
      expandedPerks,
    };
  });
}

// Choose which unlocked perk to surface in the collapsed view. Prefer a
// tagged perk when one exists in the unlocked set (so a crafted weapon
// with the godroll perk available shows the godroll's icon, not whichever
// happens to be currently equipped). Otherwise the first rolled in stable
// order. Returns undefined when no perks are unlocked.
export function selectCollapsedPerk(
  perks: readonly PerkVisualState[],
): PerkVisualState | undefined {
  const rolled = perks.filter((p) => p.isRolledOnGun);
  if (rolled.length === 0) return undefined;
  const taggedRolled = rolled.find((p) => p.isWishlistTagged);
  return taggedRolled ?? rolled[0];
}

// Snapshotless model: built from entry's parallel arrays alone for the
// pre-snapshot collapsed render. Each captured perk becomes one column with
// a synthesized socketIndex (its parallel-array position). expandedPerks
// stays empty — the expanded view always waits for the real snapshot.
//
// All entries here have isRolledOnGun=true by definition (these ARE the
// equipped perks). Tagged-ness is tested against the flat union of all
// matches' taggedPerkHashes — same per-column outcome as the with-snapshot
// path because perks are unique to columns in practice.
function buildSnapshotlessModel(
  entry: DropFeedEntry,
  wishlistMatches: WishlistMatch[],
  normalize: (h: number) => number,
): PerkColumnDisplayModel[] {
  const taggedHashes: number[] = [];
  for (const m of wishlistMatches) {
    for (const h of m.taggedPerkHashes ?? []) taggedHashes.push(h);
  }
  const perkHashes = entry.perkHashes ?? [];
  const perkIcons = entry.perkIcons;
  return perkHashes.map((hash, i) => {
    const state = classifyPerkVisualState({
      perkHash: hash,
      socketIndex: i,
      // The equipped perk is always rolled — pass it as the unlocked set so
      // classifyPerkVisualState's isRolledOnGun resolves true.
      unlockedHashesForSocket: [hash],
      taggedHashesForSocket: taggedHashes,
      normalize,
    });
    return {
      socketIndex: i,
      label: '',
      collapsedPerk: state,
      collapsedIconUrl: perkIcons[i],
      expandedPerks: [],
    };
  });
}

// Reads the entry's unlocked-perks data with legacy fallbacks. Brief #14.4
// stores unlockedPerksBySocketIndex as a record; older entries used a
// parallel array keyed by capture-order index, and the very oldest just
// had perkHashes. The snapshot's column.socketIndex order tells us how to
// realign the parallel array — assumes capture order matched column order
// at the time, which was true for the controller's slice(0, 6) capture.
function readUnlockedBySocketIndex(
  entry: DropFeedEntry,
  snapshot: WeaponPerkPoolSnapshot,
): Record<number, number[]> {
  if (entry.unlockedPerksBySocketIndex) {
    return entry.unlockedPerksBySocketIndex;
  }
  const result: Record<number, number[]> = {};
  if (entry.unlockedPerksPerColumn) {
    snapshot.columns.forEach((col, i) => {
      const v = entry.unlockedPerksPerColumn?.[i];
      if (v) result[col.socketIndex] = v;
    });
    return result;
  }
  if (entry.perkHashes) {
    snapshot.columns.forEach((col, i) => {
      const v = entry.perkHashes?.[i];
      if (v !== undefined) result[col.socketIndex] = [v];
    });
  }
  return result;
}
