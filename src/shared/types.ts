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
}

export interface DropLockUpdatedPayload {
  instanceId: string;
  locked: boolean;
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
