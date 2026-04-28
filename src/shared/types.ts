// Grade type from scoring/types is no longer needed here after Brief #12.5
// removed `grade` from DropFeedEntry. The scoring types file still defines and
// exports Grade for CustomRule.grade (a config field, not runtime).

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

// Brief #12.5 Part D: lightweight metadata derived from the per-source
// ImportedWishList. UI only needs name + entry count + last-updated for
// display; carrying the full entries array (60 MB+ combined for 4 sources)
// through chrome.storage IPC into the settings page context was the source
// of the multi-second freeze on first Weapons tab open.
//
// Stored under its own key (wishlistMetadata) so the settings page subset
// can include it without dragging in the heavy entries blob. Kept in sync
// with saveWishlists writes — they're a derived view, not a separate source
// of truth.
export interface WishlistMetadata {
  id: string;
  name: string;
  sourceUrl: string | null;
  entryCount: number;
  importedAt: number;
}

// One curated or user-added wishlist source. Stored in chrome.storage under
// the wishlistSources key. The parsed entries live separately as
// ImportedWishList[] keyed by source id.
//
// pveOriented / pvpOriented (Brief #12): orientation tags used by the roll-type
// filter on the Weapons tab. A source can be both, neither, or one. Built-ins
// flagged in known-sources.ts. Custom URLs default to neither.
//
// configurable (Brief #19): the source's URL is computed from a config blob
// rather than statically declared. The runtime `url` field is recomputed at
// load time from the current config (see loadWishlistSources). Today only the
// Charles MRF_PPC source uses this — its URL switches with the user's
// minTier/ppc selector. The configurable flag stays serialized so the runtime
// shape can pass through storage unchanged; computeUrl + defaultConfig live
// in known-sources.ts metadata, not on the runtime source.
//
// notificationOnly (Brief #21): when true, matches from this source fire
// notifications but produce no Drop Log visual decoration (no tier chip
// influence, no source tag, no gold-border contribution). User-added custom
// URLs default to true — they're useful as private alert signals but
// shouldn't masquerade as curated quality. Built-ins default to false.
export interface WishlistSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  builtin: boolean;
  description?: string;
  pveOriented?: boolean;
  pvpOriented?: boolean;
  configurable?: boolean;
  notificationOnly?: boolean;
}

// Brief #19: Charles MRF_PPC selector config. Persists to its own
// charlesSourceConfig storage key (not folded into wishlistSources or
// WeaponFilterConfig — keeping concerns separate). minTier maps to
// MR{S|A|B|C|D|F}; ppc maps to PPC{0|1|2|3}. The combinatorial product
// gives 28 possible URL targets in Charles's repo; computeCharlesUrl in
// known-sources.ts derives the URL from this config.
export interface CharlesSourceConfig {
  minTier: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  ppc: 0 | 1 | 2 | 3;
}

export const DEFAULT_CHARLES_CONFIG: CharlesSourceConfig = {
  // F = full S-F coverage. Most permissive default; Charles's site recommends
  // starting here and letting users tighten via the selector.
  minTier: 'F',
  ppc: 0,
};

// Brief #12: TierFilter retained for the migration adapter only.
// Pre-Brief #19 WeaponFilterConfig stored a tierFilter that we now read once
// to seed CharlesSourceConfig.minTier on first load after the upgrade. New
// code shouldn't reference this — read charlesSourceConfig.minTier instead.
export type TierFilter = 'all' | TierLetter;

// Brief #12 RollTypeFilter retained for the migration adapter only. Brief
// #19 replaces roll-type with PerksPerColumn (PPC) on Charles's selector;
// Voltron transitions to confirmation signal. Old field is read once on
// load and otherwise ignored.
export type RollTypeFilter = 'all-matched' | 'strong-pve' | 'popular';

// Brief #19: WeaponFilterConfig now holds only the Voltron-confirmation
// toggle. Tier + roll-type were replaced by Charles's two-axis selector
// (charlesSourceConfig.minTier / .ppc) — the URL itself filters by tier,
// so the post-fetch tier check became redundant. The legacy fields (still
// in WeaponFilterConfigLegacy) are read once by the migration adapter.
export interface WeaponFilterConfig {
  // When true, Voltron matches that overlap with a Charles match are flagged
  // confirmsCharles=true (data-only marker for Brief #20's UI). When false,
  // Voltron behaves as a normal independent source.
  voltronConfirmation: boolean;
}

export const DEFAULT_WEAPON_FILTER: WeaponFilterConfig = {
  voltronConfirmation: true,
};

// Pre-Brief #19 stored shape, used by the migration adapter in
// scoring-config.ts to seed the new Charles config + WeaponFilterConfig
// without losing user state.
export interface WeaponFilterConfigLegacy {
  tierFilter?: TierFilter;
  rollTypeFilter?: RollTypeFilter;
  voltronConfirmation?: boolean;
}

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
  // Brief #14 Part B: the wishlist entry's required perk hashes for this
  // match — i.e. the perks the source explicitly flagged for this roll.
  // Stored canonical (base form, not enhanced) so render-side membership
  // checks against DropFeedEntry.perkHashes work directly. Absent on legacy
  // pre-#14 matches; renderers must guard with optional chaining and treat
  // missing as "no annotation available, render all perks at full opacity."
  taggedPerkHashes?: number[];
  // Brief #19: data-only marker set by the matcher when (a) voltronConfirmation
  // is on AND (b) a Charles source matched the same drop AND (c) this match's
  // sourceId is voltron. UI in Brief #20 reads this to swap the source tag for
  // a "thumbs-up" decoration on the Charles tag instead of rendering as a
  // standalone source. Absent (or false) means render normally.
  confirmsCharles?: boolean;
  // Brief #21: mirrors the source's notificationOnly flag at match time.
  // Matches stay in entry.wishlistMatches (the notification path consumes
  // them), but renderers filter on this flag before computing tier chips,
  // source tags, gold borders, and godroll union. Custom-URL sources
  // default notification-only; built-ins default off.
  notificationOnly?: boolean;
}

export interface DropFeedEntry {
  instanceId: string;
  itemName: string;
  itemIcon: string;
  itemType: 'weapon' | 'armor';
  timestamp: number;
  locked: boolean;
  perkIcons: string[];
  // Brief #14 Part B: plug hashes parallel to perkIcons (same length, same
  // order). Each hash is canonical-form (enhanced perks resolved to their
  // base hash via enhancedPerkMap at capture time) so set-membership against
  // WishlistMatch.taggedPerkHashes works directly. Absent on pre-#14 entries.
  perkHashes?: number[];
  // Brief #14.3 Bug 4 (deprecated by #14.4): parallel-array shape, kept for
  // legacy reads. New entries write unlockedPerksBySocketIndex below; the
  // display model builder converts old shape on read.
  unlockedPerksPerColumn?: number[][];
  // Brief #14.4: per-socket unlocked set, keyed by manifest socket index
  // rather than by parallel array position. Eliminates index-drift bugs
  // when the captured perk count diverges from the rendered column count.
  // Inner array contains canonical-form hashes (enhanced→base) the user
  // has unlocked in that socket. For non-crafted random-roll drops it's
  // [equippedPerkHash]; for crafted weapons it includes every shaped
  // alternative.
  unlockedPerksBySocketIndex?: Record<number, number[]>;
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
  // Brief #14 Part E: weapon/armor itemHash. Needed to look up the perk
  // pool for the expand-on-click view (which calls perkPool:get with this).
  // Absent on pre-#14 entries — those rows aren't expandable.
  itemHash?: number;
  // Brief #14.5: union of every keeper-entry perk hash any enabled wishlist
  // flagged as a godroll for this weapon — including ones the drop didn't
  // roll. Display layer gold-borders any of these whether or not the user
  // actually got them, so the expand view shows "what else would have been
  // good." Canonicalized via enhancedPerkMap at capture time. Absent on
  // pre-#14.5 entries; renderers treat absence as "no extra godrolls beyond
  // wishlistMatches[].taggedPerkHashes."
  weaponGodrollHashes?: number[];
  // Brief #14 Part D: Bungie manifest version active at drop capture time.
  // Used by the expand-on-click view to label "captured against v[X]" when
  // it differs from current — perk pools and tier readings shift across
  // sandbox patches, so a months-old drop may not match what the live
  // manifest says rolled. Absent on pre-#14 entries; render code treats
  // absence as "no disclaimer needed" (best effort, no claims about era).
  manifestVersion?: string;
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
  // Brief #14.3 Bug 4: full set of unlocked alternatives the user can swap
  // to in this socket. For non-crafted random-roll drops this is just
  // [plugHash] (only the equipped perk is "rolled"). For crafted weapons
  // it's every shaped perk the user has unlocked. Source: socket's
  // reusablePlugs[].plugItemHash, filtered to canInsert + enabled. Absent
  // when the inventory snapshot didn't include reusablePlugs (treat as
  // single-perk fallback at consume time).
  unlockedPlugHashes?: number[];
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
