export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export type ArmorSlot = 'Helmet' | 'Gauntlets' | 'Chest' | 'Leg' | 'ClassItem';

export type ArmorClass = 'Titan' | 'Hunter' | 'Warlock';

export interface ArmorStat {
  name: string;
  value: number;
  icon: string | null;
}

export interface ArmorRoll {
  itemHash: number;
  itemInstanceId: string;
  itemName: string;
  slot: ArmorSlot | 'Unknown';

  armorClass: ArmorClass | null;

  setName: string | null;

  tier: 1 | 2 | 3 | 4 | 5 | null;

  archetype: string | null;
  archetypeIcon: string | null;

  primaryStat: ArmorStat | null;
  secondaryStat: ArmorStat | null;
  tertiaryStat: ArmorStat | null;

  tuningActive: boolean;
  tuningStatName: string | null;

  allStats: Record<string, number>;

  isLegacyArmor: boolean;
}

// Re-exported from core/rules/armor-rules.ts to avoid circular imports.
import type { ArmorRule } from '@/core/rules/armor-rules';
export type { ArmorRule };

import type { TierLetter, WishlistMatch } from '@/shared/types';

export interface WishListEntry {
  sourceListId: string;
  itemHash: number;
  requiredPerks: number[];
  isTrash: boolean;
  notes: string;
  // Brief #12: per-weapon tier extracted from preceding //notes: blocks in
  // Aegis-style sources. Absent on entries from sources that don't carry
  // tier info (Voltron's older entries, custom URLs, etc.).
  weaponTier?: TierLetter;
}

export interface ImportedWishList {
  id: string;
  name: string;
  sourceUrl: string | null;
  entries: WishListEntry[];
  importedAt: number;
  entryCount: number;
}

// Weapon-only custom rules. Armor uses ArmorRule.
export interface CustomRule {
  name: string;
  grade: 'S' | 'A' | 'B' | 'F';
  weaponNames?: string[];
  perks?: string[];
  frames?: string[];
  isCrafted?: boolean;
}

// Brief #12.5: NotificationThreshold removed (Part B), AlertThreshold removed
// (Part C — only consumer was shouldAlert which had zero readers anywhere).
// WeaponFilterConfig on the Weapons tab is the canonical notification gate now.

// Brief #11 Part D: `wishlists: ImportedWishList[]` removed. The matcher now
// reads from the wishlist cache (src/core/wishlists/cache.ts) directly, so
// scoring no longer needs the parsed lists injected via config. ImportedWishList
// is still defined above and used by the parser, cache, and storage helpers.
export interface ScoringConfig {
  customRules: CustomRule[];
  armorRules: ArmorRule[];
  autoLockOnArmorMatch: boolean;
  excludeCrafted: boolean;
}

// Brief #12.5 Part C: `grade` and `shouldAlert` removed. Grade was a per-roll
// quality letter (S/A/B/C/D/F) that conflated "matched a wishlist" with "rarity
// fallback"; Brief #12 split those into wishlistMatches (matched signal) and
// weaponTier (per-weapon ranking from Aegis sources). The autolock predicate
// in controller.ts now reads wishlistMatches.length instead of grade === 'S'.
// shouldAlert had zero readers; AlertThreshold existed only to compute it.
//
// Brief #11 Part D: replaced single `matchedWishListEntry: WishListEntry | null`
// with `wishlistMatches: WishlistMatch[]`. The matcher now returns one match per
// flagging source (keeper-wins semantics; trash matches don't appear here but
// still drive isTrash via the engine's winner inspection).
export interface ScoreResult {
  shouldAutoLock: boolean;
  armorMatched: boolean | null;
  matchedArmorRule: ArmorRule | null;
  wishlistMatches: WishlistMatch[];
  matchedCustomRule: CustomRule | null;
  isTrash: boolean;
  excluded: boolean;
  reasons: string[];
  armorRoll: ArmorRoll | null;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  customRules: [],
  armorRules: [],
  autoLockOnArmorMatch: true,
  excludeCrafted: true,
};
