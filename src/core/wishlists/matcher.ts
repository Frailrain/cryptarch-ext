import type { NewItemDrop, WishlistMatch } from '@/shared/types';
import type { ImportedWishList, WishListEntry } from '@/core/scoring/types';
import { loadWishlistSources } from '@/core/storage/scoring-config';
import { getAllCachedLists } from './cache';

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
  const enabledIds = new Set(
    loadWishlistSources()
      .filter((s) => s.enabled)
      .map((s) => s.id),
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
      keeperMatches.push({
        sourceId: list.id,
        sourceName: list.name,
        notes: perListResult.keeper.notes ? perListResult.keeper.notes : undefined,
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

  return {
    keeperMatches,
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
