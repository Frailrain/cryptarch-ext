import type {
  NewItemDrop,
  TierFilter,
  TierLetter,
  WishlistMatch,
} from '@/shared/types';
import type { ImportedWishList, WishListEntry } from '@/core/scoring/types';
import {
  loadWeaponFilterConfig,
  loadWishlistSources,
} from '@/core/storage/scoring-config';
import { CHARLES_SOURCE_ID } from './known-sources';
import { getAllCachedLists } from './cache';
import { passesTierFilter } from './filters';

// The "Voltron family" of source ids that participate in the Brief #19
// confirmation logic. Both base Voltron and Choosy Voltron count — they
// share an upstream curator and conceptually fill the same role.
const VOLTRON_SOURCE_IDS: ReadonlySet<string> = new Set(['voltron', 'choosy-voltron']);

// Tier ordering: index 0 is best (S), index 5 is worst (F). resolveBestTier
// uses indexOf so a drop with matches at A and C resolves to A.
const TIER_ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];

/**
 * Resolve the canonical drop-level tier from a set of per-source matches.
 * Picks the highest tier (S beats A, A beats B, ...) across matches that
 * have weaponTier set. Matches without tier data are skipped.
 *
 * Returns undefined when no match carries tier data — typical for drops
 * matched only by Voltron entries that don't reference an Aegis tier in
 * their notes. Tier filtering treats undefined as below-F (does not pass
 * any letter threshold), see Brief #12 Part C.
 */
// Brief #14.5: collect every keeper-entry perk hash for this weapon across
// every enabled wishlist. Used by the display layer to gold-border perks
// that any wishlist considers a godroll for this weapon — including ones
// the user's specific drop didn't roll. Catch-all entries (itemHash === -1)
// are included with the same logic the matcher uses for keeper detection.
//
// Tier filter (Brief #14.5 follow-up): exhaustive sources like Voltron list
// many keeper entries per weapon — all reasonable rolls across PVE/PVP/etc.
// Unioning all of them flooded D-tier weapons (e.g. Bitter End) with gold
// borders on nearly every perk because every Voltron entry, even D-tier,
// contributed. Filtering by the user's WeaponFilterConfig tier threshold
// (default A) keeps the godroll union honest: low-tier weapons contribute
// nothing to the union, the matched roll's perks still tag via
// wishlistMatches[].taggedPerkHashes (independent path), and S/A weapons
// behave the same as before.
//
// Returns the deduped union as a number[]. The controller canonicalizes
// each hash via enhancedPerkMap before storing on the DropFeedEntry.
export function collectWeaponGodrolls(
  weaponItemHash: number,
  tierFilter: TierFilter = 'all',
  // Brief #21: when true, restrict the union to Charles's source only.
  // The Weapons tab's voltronConfirmation toggle drives this — Charles is
  // primary in confirmation mode, so secondary sources don't influence the
  // gold-border decoration even when they're enabled. When false, every
  // enabled non-notification-only source contributes (Voltron, Choosy
  // Voltron, deprecated Aegis if power-user re-enabled).
  charlesOnly = false,
): number[] {
  const sources = loadWishlistSources();
  // notificationOnly sources never contribute regardless of mode — those
  // alerts are intentional dark-data signals, not curator quality.
  const eligibleIds = new Set(
    sources
      .filter((s) => s.enabled && !s.notificationOnly)
      .filter((s) => !charlesOnly || s.id === CHARLES_SOURCE_ID)
      .map((s) => s.id),
  );
  const lists = getAllCachedLists().filter((list) => eligibleIds.has(list.id));
  const godrolls = new Set<number>();
  for (const list of lists) {
    for (const entry of list.entries) {
      if (entry.isTrash) continue;
      if (entry.itemHash !== -1 && entry.itemHash !== weaponItemHash) continue;
      // Untiered entries fail the filter when the user has set a threshold —
      // matches the existing notification-side passesTierFilter semantics
      // (Brief #12). Sources that don't carry tier info contribute when
      // tierFilter === 'all'.
      if (!passesTierFilter(entry.weaponTier, tierFilter)) continue;
      for (const p of entry.requiredPerks) godrolls.add(p);
    }
  }
  return Array.from(godrolls);
}

export function resolveBestTier(matches: WishlistMatch[]): TierLetter | undefined {
  let bestIdx: number | null = null;
  for (const m of matches) {
    if (!m.weaponTier) continue;
    const idx = TIER_ORDER.indexOf(m.weaponTier);
    if (idx === -1) continue;
    if (bestIdx === null || idx < bestIdx) bestIdx = idx;
  }
  return bestIdx === null ? undefined : TIER_ORDER[bestIdx];
}

/**
 * Result returned to the scoring engine. Two shapes in one envelope because
 * grading and persistence have different needs:
 *
 *   - `keeperMatches` is the persistence/UI shape (one entry per source whose
 *     keeper entries flagged the drop). Stored on DropFeedEntry, displayed as
 *     source tags in Drop Log and notifications. Empty when no source contains
 *     a keeper match.
 *   - `winner` is the grading shape (the single WishListEntry that decides
 *     S vs D vs fallback). Carries notes and isTrash for the engine to consume.
 *     Null when no source contains any match for this drop.
 *
 * Brief #11 decision: keeper from any enabled source overrides trash from
 * another. Preserves pre-#11 behavior where the matcher returned the first
 * keeper it found and fell through to trash only when no keeper existed
 * anywhere.
 *
 * Trash-wins semantics (where any source's trash entry overrides other sources'
 * keepers) is a deliberate UX change worth a future brief. The case for it: a
 * user who enables Choosy Voltron explicitly wants the stricter opinions to
 * bite. The case against: it's a silent behavior change for existing
 * solo-Voltron users on items where Voltron itself contains both a keeper and
 * trash entry for the same roll.
 *
 * If a future brief introduces source-priority or trash-priority behavior, this
 * is the place to change it.
 */
export interface MatcherResult {
  keeperMatches: WishlistMatch[];
  winner: { entry: WishListEntry; sourceName: string } | null;
}

/**
 * Match a drop against every cached wishlist. The matcher reads from the
 * in-memory cache (populated by `hydrateWishlistCache()` at controller startup);
 * it no longer takes the wishlists array as a parameter.
 *
 * Per-source resolution: within a single list, a keeper entry beats a trash
 * entry for the same roll (current behavior). Across sources: any keeper beats
 * any trash. The `winner` therefore prefers the first keeper encountered and
 * falls back to the first trash only when no source has a keeper.
 */
export function matchDropAgainstWishlists(
  drop: NewItemDrop,
  enhancedPerkMap: Map<number, number>,
): MatcherResult {
  // Filter cached lists by current enabled state. The cache may contain entries
  // for sources the user has since disabled — keeping the parsed data around
  // means a re-enable doesn't force an immediate re-fetch (the staleness check
  // in fetch.ts handles that). But scoring must respect the live enable flag,
  // so a disabled source's cached entries are excluded here.
  // Brief #21: snapshot sources here so we can stamp each WishlistMatch with
  // its source's notificationOnly flag — needed by renderer-side filtering
  // and the notification path's "any non-NO source matched?" check.
  const sources = loadWishlistSources();
  const enabledIds = new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  const notificationOnlyIds = new Set(
    sources.filter((s) => s.notificationOnly === true).map((s) => s.id),
  );
  const lists = getAllCachedLists().filter((list) => enabledIds.has(list.id));
  if (lists.length === 0) {
    return { keeperMatches: [], winner: null };
  }

  const activePerks = new Set<number>();
  for (const p of drop.perks) {
    if (p.isActive) activePerks.add(p.plugHash);
  }

  // Enhanced perk hashes resolve to their base versions so a wishlist line
  // requiring the base perk still matches a drop with the enhanced variant.
  const resolvedPerks = new Set<number>(activePerks);
  for (const perk of activePerks) {
    const base = enhancedPerkMap.get(perk);
    if (base !== undefined) resolvedPerks.add(base);
  }

  const keeperMatches: WishlistMatch[] = [];
  let firstKeeper: { entry: WishListEntry; sourceName: string } | null = null;
  let firstTrash: { entry: WishListEntry; sourceName: string } | null = null;

  for (const list of lists) {
    const perListResult = matchDropAgainstSingleList(drop, list, resolvedPerks);
    if (perListResult.keeper) {
      // Brief #14 Part B: copy requiredPerks onto the match so the dashboard
      // can dim non-tagged rolled perks. Empty when the wishlist entry had
      // no perk requirements (item-only match like an exotic) — renderer
      // treats that as "no annotation, all perks full opacity."
      const taggedPerkHashes =
        perListResult.keeper.requiredPerks.length > 0
          ? [...perListResult.keeper.requiredPerks]
          : undefined;
      keeperMatches.push({
        sourceId: list.id,
        sourceName: list.name,
        notes: perListResult.keeper.notes ? perListResult.keeper.notes : undefined,
        weaponTier: perListResult.keeper.weaponTier,
        taggedPerkHashes,
        notificationOnly: notificationOnlyIds.has(list.id) ? true : undefined,
      });
      if (!firstKeeper) {
        firstKeeper = { entry: perListResult.keeper, sourceName: list.name };
      }
    } else if (perListResult.trash) {
      if (!firstTrash) {
        firstTrash = { entry: perListResult.trash, sourceName: list.name };
      }
    }
  }

  // Brief #19: Voltron-as-confirmation post-processing. When the user opts
  // in via voltronConfirmation:
  //   - If Charles matched the drop, mark Voltron-family matches with
  //     confirmsCharles=true (data-only flag for Brief #20's UI).
  //   - If Charles did NOT match (drop falls outside the user's tier scope),
  //     drop the Voltron-family match entirely. Charles is primary; Voltron
  //     decorates Charles. Without Charles, Voltron's signal isn't shown.
  // When the toggle is off, Voltron behaves as an independent source — its
  // matches stay in the result with no flag.
  const voltronConfirmation = loadWeaponFilterConfig().voltronConfirmation;
  const charlesMatched = keeperMatches.some((m) => m.sourceId === CHARLES_SOURCE_ID);
  const finalMatches = voltronConfirmation
    ? keeperMatches.flatMap((m) => {
        if (!VOLTRON_SOURCE_IDS.has(m.sourceId)) return [m];
        if (!charlesMatched) return []; // suppress
        return [{ ...m, confirmsCharles: true }];
      })
    : keeperMatches;

  return {
    keeperMatches: finalMatches,
    winner: firstKeeper ?? firstTrash,
  };
}

interface PerListResult {
  keeper: WishListEntry | null;
  trash: WishListEntry | null;
}

function matchDropAgainstSingleList(
  drop: NewItemDrop,
  list: ImportedWishList,
  resolvedPerks: Set<number>,
): PerListResult {
  let perListKeeper: WishListEntry | null = null;
  let perListTrash: WishListEntry | null = null;

  for (const entry of list.entries) {
    if (entry.itemHash !== -1 && entry.itemHash !== drop.itemHash) continue;

    if (entry.requiredPerks.length > 0) {
      let allPresent = true;
      for (const req of entry.requiredPerks) {
        if (!resolvedPerks.has(req)) {
          allPresent = false;
          break;
        }
      }
      if (!allPresent) continue;
    }

    if (entry.isTrash) {
      if (!perListTrash) perListTrash = entry;
    } else {
      perListKeeper = entry;
      // Within a single list, the first keeper match is sufficient — keeper
      // beats any later trash entry for the same source.
      break;
    }
  }

  return { keeper: perListKeeper, trash: perListTrash };
}
