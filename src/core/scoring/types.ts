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

export interface WishListEntry {
  sourceListId: string;
  itemHash: number;
  requiredPerks: number[];
  isTrash: boolean;
  notes: string;
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

export type AlertThreshold = 'S' | 'SA' | 'all';

export type NotificationThreshold = 'S' | 'SA' | 'SAB';

export interface ScoringConfig {
  wishlists: ImportedWishList[];
  customRules: CustomRule[];
  armorRules: ArmorRule[];
  alertThreshold: AlertThreshold;
  notificationThreshold: NotificationThreshold;
  autoLockOnArmorMatch: boolean;
  excludeCrafted: boolean;
}

export interface ScoreResult {
  shouldAlert: boolean;
  shouldAutoLock: boolean;
  grade: Grade | null;
  armorMatched: boolean | null;
  matchedArmorRule: ArmorRule | null;
  matchedWishListEntry: WishListEntry | null;
  matchedCustomRule: CustomRule | null;
  isTrash: boolean;
  excluded: boolean;
  reasons: string[];
  armorRoll: ArmorRoll | null;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  wishlists: [],
  customRules: [],
  armorRules: [],
  alertThreshold: 'SA',
  notificationThreshold: 'S',
  autoLockOnArmorMatch: true,
  excludeCrafted: true,
};
