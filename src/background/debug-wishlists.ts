// Brief #11 debug helpers. Exposed on globalThis as `cryptarchDebug` so the
// service worker DevTools console can drive synthetic drops through the full
// scoring pipeline without needing live Bungie inventory churn.
//
// Open the SW devtools at chrome://extensions → Cryptarch → "service worker"
// link, then call any of the methods below. Examples:
//
//   await cryptarchDebug.cacheSummary()
//   cryptarchDebug.findMultiSourceItems(2)
//   await cryptarchDebug.testMatch(2870317354)        // pick a hash from above
//   await cryptarchDebug.testFallback()
//
// The helpers read from the live wishlist cache, so the user's enabled-source
// configuration affects results — exactly what we want for verifying
// multi-source detection end-to-end.
//
// Permanent rather than temporary: cost is small (~3 kB in the SW bundle), the
// surface is only reachable from the SW devtools console (not from web pages),
// and ad-hoc verification stays useful past Brief #11. Remove if SW console
// attack surface ever becomes a concern.

import { ItemType, type NewItemDrop, type TierLetter, type WishlistMatch } from '@/shared/types';
import { scoreItem } from '@/core/scoring/engine';
import { loadScoringConfig, loadWishlistSources } from '@/core/storage/scoring-config';
import { getAllCachedLists, ensureWishlistCacheReady } from '@/core/wishlists/cache';
import { getEnhancedPerkMap, getManifest } from '@/core/bungie/manifest';
import type { Grade } from '@/core/scoring/types';

// Local copy of tier ranking used to compute the best (lowest-index) tier
// across multiple matching entries when scanning candidates in
// findMultiSourceItems. Mirrors TIER_ORDER in matcher.ts.
const TIER_RANK_LOCAL: Record<TierLetter, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};

export interface MultiSourceItem {
  itemHash: number;
  sources: string[];
  samplePerks: number[];
  // Brief #12: best tier across the matching keeper entries for this item
  // (best = lowest TIER_RANK index, i.e. S beats A). Absent when no matching
  // entry carries weaponTier metadata.
  bestTier?: TierLetter;
}

interface TestMatchOutcome {
  grade: Grade | null;
  wishlistMatches: WishlistMatch[];
  isTrash: boolean;
  reasons: string[];
}

async function ensureReady(): Promise<Map<number, number>> {
  await ensureWishlistCacheReady();
  let perkMap = new Map<number, number>();
  try {
    await getManifest();
    perkMap = await getEnhancedPerkMap();
  } catch {
    // Continue with empty map — wishlist matches against base perks still work,
    // only enhanced-variant resolution is degraded.
  }
  return perkMap;
}

function buildSyntheticDrop(
  itemHash: number,
  perks: number[],
  tierType: 'Legendary' | 'Rare' = 'Legendary',
): NewItemDrop {
  return {
    instanceId: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemHash,
    bucketHash: 0,
    name: `debug-item-${itemHash}`,
    iconUrl: '',
    itemTypeEnum: ItemType.Weapon,
    itemSubType: 'Weapon',
    tierType,
    damageType: null,
    perks: perks.map((plugHash, columnIndex) => ({
      columnIndex,
      plugHash,
      plugName: '',
      plugIcon: '',
      isActive: true,
    })),
    stats: {},
    characterId: '',
    membershipType: 0,
    isCrafted: false,
    location: 'inventory',
    detectedAt: Date.now(),
  };
}

async function enabledSources() {
  await ensureWishlistCacheReady();
  return loadWishlistSources().filter((s) => s.enabled);
}

async function cacheSummary() {
  await ensureWishlistCacheReady();
  const enabledIds = new Set(loadWishlistSources().filter((s) => s.enabled).map((s) => s.id));
  return getAllCachedLists().map((l) => ({
    id: l.id,
    name: l.name,
    entryCount: l.entryCount,
    enabled: enabledIds.has(l.id),
  }));
}

/**
 * Walk the live cache (enabled sources only), group keeper entries by item hash,
 * and return hashes flagged by at least `minSources` sources. Useful for picking
 * a real multi-source target before calling testMatch.
 *
 * Returned `samplePerks` come from the first matching keeper entry encountered —
 * good for handing straight to testMatch as a guaranteed-match fixture.
 */
async function findMultiSourceItems(
  minSources = 2,
  limit = 10,
): Promise<MultiSourceItem[]> {
  await ensureWishlistCacheReady();
  const enabledIds = new Set(
    loadWishlistSources().filter((s) => s.enabled).map((s) => s.id),
  );
  const lists = getAllCachedLists().filter((l) => enabledIds.has(l.id));

  interface Group {
    sources: Set<string>;
    perks: number[];
    bestTierIdx: number;
    bestTier?: TierLetter;
  }
  const groups = new Map<number, Group>();

  for (const list of lists) {
    // Track first-seen-keeper-entry per (list, itemHash) so we don't double-count
    // a list that has multiple entries for the same hash. Note: tier tracking
    // does need to consider all entries in the list (different rolls may have
    // different tier annotations), so we do tier comparison BEFORE this dedupe
    // check below.
    const seenInList = new Set<number>();
    for (const entry of list.entries) {
      if (entry.isTrash) continue;
      if (entry.itemHash === -1) continue; // skip catch-all entries

      let group = groups.get(entry.itemHash);
      if (!group) {
        group = {
          sources: new Set(),
          perks: entry.requiredPerks,
          bestTierIdx: 99,
          bestTier: undefined,
        };
        groups.set(entry.itemHash, group);
      }

      // Improve tier from any entry encountered (best across all matching
      // entries across all lists wins).
      if (entry.weaponTier) {
        const idx = TIER_RANK_LOCAL[entry.weaponTier];
        if (idx < group.bestTierIdx) {
          group.bestTierIdx = idx;
          group.bestTier = entry.weaponTier;
        }
      }

      // Source dedup applies after tier consideration.
      if (seenInList.has(entry.itemHash)) continue;
      seenInList.add(entry.itemHash);
      group.sources.add(list.id);
    }
  }

  const out: MultiSourceItem[] = [];
  for (const [itemHash, group] of groups) {
    if (group.sources.size < minSources) continue;
    out.push({
      itemHash,
      sources: Array.from(group.sources),
      samplePerks: group.perks,
      bestTier: group.bestTier,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Synthesize a drop with the given hash + perks and run it through the full
 * scoring pipeline. If `perks` is omitted, picks the first matching keeper
 * entry from the cache so the drop is guaranteed to match (assuming the hash
 * appears in any enabled source's cache).
 */
async function testMatch(itemHash: number, perks?: number[]): Promise<TestMatchOutcome> {
  const perkMap = await ensureReady();

  let usePerks = perks;
  if (!usePerks) {
    const enabledIds = new Set(
      loadWishlistSources().filter((s) => s.enabled).map((s) => s.id),
    );
    for (const list of getAllCachedLists()) {
      if (!enabledIds.has(list.id)) continue;
      const found = list.entries.find(
        (e) => !e.isTrash && (e.itemHash === itemHash || e.itemHash === -1),
      );
      if (found) {
        usePerks = found.requiredPerks;
        break;
      }
    }
  }
  if (!usePerks) {
    usePerks = [];
    console.warn(
      `[cryptarchDebug] No matching keeper entry found for hash ${itemHash} in any enabled source's cache. Running with empty perks (will likely fall through to tier-based grade).`,
    );
  }

  const drop = buildSyntheticDrop(itemHash, usePerks);
  const config = loadScoringConfig();
  config.armorRules = []; // not needed for weapon scoring

  const result = scoreItem(drop, config, perkMap);

  const outcome: TestMatchOutcome = {
    grade: result.grade,
    wishlistMatches: result.wishlistMatches,
    isTrash: result.isTrash,
    reasons: result.reasons,
  };
  console.log('[cryptarchDebug.testMatch]', {
    itemHash,
    perks: usePerks,
    outcome,
  });
  return outcome;
}

/**
 * Convenience: synthesize a drop with a deliberately-unrecognized hash and no
 * perks. Should grade B (Legendary fallback). If it grades anything else, the
 * fallback path is broken or the matcher is matching catch-all entries it
 * shouldn't.
 */
async function testFallback(): Promise<TestMatchOutcome> {
  const perkMap = await ensureReady();
  const drop = buildSyntheticDrop(0xffffffff, []);
  const config = loadScoringConfig();
  config.armorRules = [];
  const result = scoreItem(drop, config, perkMap);
  const outcome: TestMatchOutcome = {
    grade: result.grade,
    wishlistMatches: result.wishlistMatches,
    isTrash: result.isTrash,
    reasons: result.reasons,
  };
  console.log('[cryptarchDebug.testFallback]', outcome);
  return outcome;
}

const debugApi = {
  enabledSources,
  cacheSummary,
  findMultiSourceItems,
  testMatch,
  testFallback,
};

export function installWishlistDebug(): void {
  (globalThis as unknown as { cryptarchDebug: typeof debugApi }).cryptarchDebug = debugApi;
}

// Re-exported for the SW message handlers that back the in-UI test panel.
// Same surface as the console helpers — the panel just calls them via
// chrome.runtime.sendMessage instead of typing into devtools.
export { cacheSummary, findMultiSourceItems, testMatch, testFallback };
