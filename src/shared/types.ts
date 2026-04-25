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
export interface WishlistSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtin: boolean;
  description?: string;
}

// One match between a drop and a wishlist source. A drop may have zero, one,
// or many of these. Brief #12 may add: parsedMetadata?: { weaponTier?: string;
// perksMatched?: number } — keep this shape extensible.
export interface WishlistMatch {
  sourceId: string;
  sourceName: string;
  notes?: string;
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
// Grade array contains labels that are currently "on". S stays permanently
// in the array (the UI renders S as a non-toggleable chip).
export interface PopupFilterState {
  grade: string[];
  type: string[];
}

export const DEFAULT_POPUP_FILTER: PopupFilterState = {
  grade: ['S', 'A', 'B', 'Exotic'],
  type: ['Weapons', 'Armor'],
};

// Set by the popup when a user clicks a drop row, read by the Dashboard on
// mount to select the right tab and scroll to / briefly highlight that row.
// The Dashboard clears this key after consuming it.
export interface PendingNavigation {
  tab: 'drops' | 'rules' | 'wishlists';
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
