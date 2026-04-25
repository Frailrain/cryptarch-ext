import type { Grade } from '@/core/scoring/types';

export interface AuthStatusPayload {
  loggedIn: boolean;
  bungieName?: string;
  displayName?: string;
  platformIconPath?: string | null;
  refreshExpiresAt?: number;
}

export type PollerState = 'idle' | 'baselining' | 'polling' | 'backing-off' | 'paused';

export interface InventoryPollStatus {
  lastPollAt: number | null;
  state: PollerState;
  lastError: string | null;
  itemsKnown: number;
}

// Per-weapon tier letter parsed from Aegis-style note blocks
// (e.g. "//notes:Aegis Endgame S Tier..."). S is best, F is worst.
// Brief #12 introduces this; per-weapon, not per-roll.
export type TierLetter = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

// One curated or user-added wishlist source. Stored in chrome.storage under
// the wishlistSources key. The parsed entries live separately as
// ImportedWishList[] keyed by source id.
//
// pveOriented / pvpOriented (Brief #12): orientation tags used by the roll-type
// filter on the Weapons tab. A source can be both, neither, or one. Built-ins
// flagged in known-sources.ts. Custom URLs default to neither — TODO future
// brief: surface a checkbox in the custom-source-edit UI so users can self-tag.
// pvpOriented currently has no UI consumer (no Strong PVP filter ships in #12,
// no acceptable PVP source exists), but the field stays so a future PVP source
// + filter doesn't need a schema migration.
export interface WishlistSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtin: boolean;
  description?: string;
  pveOriented?: boolean;
  pvpOriented?: boolean;
}

// Brief #12: top-level filter config exposed on the Weapons tab. Two
// independent dimensions: tier (minimum quality threshold to notify on) and
// roll-type (which kind of match counts).
export type TierFilter = 'all' | TierLetter;

// Roll-type filter options. PVP option deliberately absent — no acceptable
// active PVP wishlist source exists as of Brief #12; see known-sources.ts.
export type RollTypeFilter = 'all-matched' | 'strong-pve' | 'popular';

export interface WeaponFilterConfig {
  tierFilter: TierFilter;
  rollTypeFilter: RollTypeFilter;
}

export const DEFAULT_WEAPON_FILTER: WeaponFilterConfig = {
  // 'A' as the minimum threshold means notify on S or A tier — sensible
  // default for users who enable Aegis sources without further configuration.
  tierFilter: 'A',
  rollTypeFilter: 'all-matched',
};

// One match between a drop and a wishlist source. A drop may have zero, one,
// or many of these. weaponTier (Brief #12) is per-source because each source
// may rate the same weapon differently — drop-level resolution to a single
// canonical tier happens in resolveBestTier (matcher.ts) and is persisted to
// DropFeedEntry.weaponTier. Sources without tier metadata (Voltron entries
// with non-Aegis-style notes, custom URLs, etc.) leave this absent.
export interface WishlistMatch {
  sourceId: string;
  sourceName: string;
  notes?: string;
  weaponTier?: TierLetter;
}

export interface DropFeedEntry {
  instanceId: string;
  itemName: string;
  itemIcon: string;
  itemType: 'weapon' | 'armor';
  grade: Grade | null;
  timestamp: number;
  locked: boolean;
  perkIcons: string[];
  weaponType: string | null;
  armorMatched: boolean | null;
  armorClass: 'Titan' | 'Hunter' | 'Warlock' | null;
  armorSet: string | null;
  armorArchetype: string | null;
  armorTertiary: string | null;
  armorTier: 4 | 5 | null;
  // Future-proofing for Session 3's exotic treatment.
  isExotic: boolean;
  // Persisted for cross-cycle autolock retries. SetLockState needs the owning
  // character; membershipType comes from the stored primary membership.
  characterId?: string;
  // Number of autolock attempts made so far (including the first). Capped at
  // 3 — beyond that we broadcast autolock-failed and stop retrying.
  retryCycleCount?: number;
  // Set to true when the item has been absent from the user's profile for
  // DELETION_CONFIRM_CYCLES consecutive polls (~90s). UI shows the row with
  // strikethrough / muted styling. Once deleted, the row never flips back.
  deleted?: boolean;
  // Wishlist sources that flagged this drop. Absent on drops captured before
  // Brief #11 — UI must guard with optional chaining.
  wishlistMatches?: WishlistMatch[];
  // Brief #12: best tier across all wishlistMatches (S > A > B > C > D > F).
  // Resolved at drop time via resolveBestTier so renderers don't recompute per
  // frame. Absent when no match has tier metadata or when drops are pre-#12.
  weaponTier?: TierLetter;
}

export interface DropLockUpdatedPayload {
  instanceId: string;
  locked: boolean;
}

export interface AutolockFailedPayload {
  itemName: string;
  instanceId: string;
  at: number;
}

// Popup filter chip state. Persisted so toggles survive popup close/reopen.
// Brief #12 reshape: replaced the old `grade: string[]` field (S/A/B/Exotic
// strings mixed in one array) with separate `tiers` (per-weapon tier letters)
// and `showExotic` (rarity flag). Migration of legacy stored values happens
// at the popup's load site — old `grade` arrays are dropped, `showExotic` is
// inferred from whether 'Exotic' was in the array, `tiers` defaults to all-on.
export interface PopupFilterState {
  type: string[];
  tiers: TierLetter[];
  showExotic: boolean;
}

export const DEFAULT_POPUP_FILTER: PopupFilterState = {
  type: ['Weapons', 'Armor'],
  tiers: ['S', 'A', 'B', 'C', 'D', 'F'],
  showExotic: true,
};

// Set by the popup when a user clicks a drop row, read by the Dashboard on
// mount to select the right tab and scroll to / briefly highlight that row.
// The Dashboard clears this key after consuming it.
export interface PendingNavigation {
  // Brief #12 renamed: 'rules' → 'armor', 'wishlists' → 'weapons'. Stale stored
  // values from before the rename are migrated at consume time in Settings.tsx.
  tab: 'drops' | 'armor' | 'weapons';
  instanceId?: string;
}

export interface ArmorTaxonomyPayload {
  sets: string[];
  archetypes: string[];
  tertiaries: string[];
}

export enum ItemType {
  None = 0,
  Currency = 1,
  Armor = 2,
  Weapon = 3,
  Message = 7,
  Engram = 8,
  Consumable = 9,
  ExchangeMaterial = 10,
  MissionReward = 11,
  QuestStep = 12,
  QuestStepComplete = 13,
  Emblem = 14,
  Quest = 15,
  Subclass = 16,
  ClanBanner = 17,
  Aura = 18,
  Mod = 19,
  Dummy = 20,
  Ship = 21,
  Vehicle = 22,
  Emote = 23,
  Ghost = 24,
  Package = 25,
  Bounty = 26,
  Wrapper = 27,
  SeasonalArtifact = 28,
  Finisher = 29,
}

export type TierType = 'Basic' | 'Common' | 'Rare' | 'Legendary' | 'Exotic' | 'Currency' | 'Unknown';

export interface PerkRoll {
  columnIndex: number;
  plugHash: number;
  plugName: string;
  plugIcon: string;
  isActive: boolean;
}

export interface DiagnosticSocketDump {
  index: number;
  socketTypeHash: number;
  plugHash: number | null;
  plugName: string | null;
  plugIcon: string | null;
  plugCategoryIdentifier: string | null;
  plugCategoryHash: number | null;
}

export interface DiagnosticStatDump {
  statHash: number;
  statName: string;
  statIcon: string | null;
  value: number;
}

export interface DiagnosticDropDump {
  itemTypeDisplayName: string | null;
  collectibleHash: number | null;
  sockets: DiagnosticSocketDump[];
  stats: DiagnosticStatDump[];
}

export interface NewItemDrop {
  instanceId: string;
  itemHash: number;
  bucketHash: number;
  name: string;
  iconUrl: string;
  itemTypeEnum: ItemType;
  itemSubType: string;
  tierType: TierType;
  damageType: string | null;
  perks: PerkRoll[];
  stats: Record<string, number>;
  characterId: string;
  membershipType: number;
  isCrafted: boolean;
  location: 'inventory' | 'vault' | 'equipped';
  detectedAt: number;
  diagnosticDump?: DiagnosticDropDump;
}

export type { Grade, ScoreResult } from '@/core/scoring/types';
