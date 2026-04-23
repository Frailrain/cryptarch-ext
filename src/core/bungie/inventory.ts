// Stateless inventory poller. The Overwolf version held a long-lived
// InventoryPoller class with adaptive timers and in-memory baseline maps; in
// a service worker neither of those survives across alarm wakeups. Instead
// the controller calls runPollCycle(...) on each alarm fire, passing in the
// baseline it just rehydrated from chrome.storage.local.

import { BUNGIE_ORIGIN, ProfileComponent } from './endpoints';
import { getProfile } from './api';
import { lookupItem, lookupStat } from './manifest';
import {
  ItemType,
  type DiagnosticDropDump,
  type DiagnosticSocketDump,
  type DiagnosticStatDump,
  type NewItemDrop,
  type PerkRoll,
  type TierType,
} from '@/shared/types';
import type {
  DestinyInventoryItem,
  DestinyItemComponent,
  DestinyItemSocket,
  DestinyProfileResponse,
} from './types';

const INTERESTING_ITEM_TYPES = new Set<ItemType>([ItemType.Weapon, ItemType.Armor]);
const IGNORED_TIER_TYPES = new Set<TierType>(['Basic', 'Common']);
const ITEM_STATE_CRAFTED = 8;

const DAMAGE_TYPE_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Kinetic',
  2: 'Arc',
  3: 'Solar',
  4: 'Void',
  6: 'Stasis',
  7: 'Strand',
};

const TIER_TYPE_NAMES: Record<number, TierType> = {
  0: 'Unknown',
  1: 'Currency',
  2: 'Basic',
  3: 'Common',
  4: 'Rare',
  5: 'Legendary',
  6: 'Exotic',
};

export interface BaselineLocation {
  containerType: 'inventory' | 'vault' | 'equipped';
  characterId: string;
}

export type BaselineMap = Record<string, BaselineLocation>;

export interface PollCycleResult {
  newDrops: NewItemDrop[];
  updatedBaseline: BaselineMap;
  itemsKnown: number;
  isBaselineCycle: boolean;
}

const PROFILE_COMPONENTS = [
  ProfileComponent.Profiles,
  ProfileComponent.ProfileInventories,
  ProfileComponent.Characters,
  ProfileComponent.CharacterInventories,
  ProfileComponent.CharacterActivities,
  ProfileComponent.CharacterEquipment,
  ProfileComponent.ItemInstances,
  ProfileComponent.ItemStats,
  ProfileComponent.ItemSockets,
];

export async function runPollCycle(
  membershipType: number,
  membershipId: string,
  priorBaseline: BaselineMap | null,
): Promise<PollCycleResult> {
  const profile = await getProfile(membershipType, membershipId, PROFILE_COMPONENTS);
  const currentMap = buildItemLocationMap(profile);
  const updatedBaseline = Object.fromEntries(currentMap.entries());

  if (!priorBaseline) {
    return {
      newDrops: [],
      updatedBaseline,
      itemsKnown: currentMap.size,
      isBaselineCycle: true,
    };
  }

  const newIds: string[] = [];
  for (const id of currentMap.keys()) {
    if (!(id in priorBaseline)) newIds.push(id);
  }

  const drops = newIds.length
    ? await buildDrops(newIds, currentMap, profile, membershipType)
    : [];
  const relevant = drops.filter(
    (d) => INTERESTING_ITEM_TYPES.has(d.itemTypeEnum) && !IGNORED_TIER_TYPES.has(d.tierType),
  );

  return {
    newDrops: relevant,
    updatedBaseline,
    itemsKnown: currentMap.size,
    isBaselineCycle: false,
  };
}

function buildItemLocationMap(profile: DestinyProfileResponse): Map<string, BaselineLocation> {
  const map = new Map<string, BaselineLocation>();

  const vaultItems = profile.profileInventory?.data?.items ?? [];
  for (const item of vaultItems) {
    if (item.itemInstanceId) {
      map.set(item.itemInstanceId, { containerType: 'vault', characterId: '' });
    }
  }

  const charInv = profile.characterInventories?.data ?? {};
  for (const [charId, bucket] of Object.entries(charInv)) {
    for (const item of bucket.items) {
      if (item.itemInstanceId) {
        map.set(item.itemInstanceId, { containerType: 'inventory', characterId: charId });
      }
    }
  }

  const charEquip = profile.characterEquipment?.data ?? {};
  for (const [charId, bucket] of Object.entries(charEquip)) {
    for (const item of bucket.items) {
      if (item.itemInstanceId) {
        map.set(item.itemInstanceId, { containerType: 'equipped', characterId: charId });
      }
    }
  }

  return map;
}

async function buildDrops(
  instanceIds: string[],
  locations: Map<string, BaselineLocation>,
  profile: DestinyProfileResponse,
  membershipType: number,
): Promise<NewItemDrop[]> {
  const itemComponents = profile.itemComponents ?? {};
  const instancesData = itemComponents.instances?.data ?? {};
  const socketsData = itemComponents.sockets?.data ?? {};
  const statsData = itemComponents.stats?.data ?? {};

  const allRawItems = collectRawItems(profile);
  const byInstanceId = new Map<string, DestinyItemComponent>();
  for (const item of allRawItems) {
    if (item.itemInstanceId) byInstanceId.set(item.itemInstanceId, item);
  }

  const drops: NewItemDrop[] = [];
  for (const id of instanceIds) {
    const raw = byInstanceId.get(id);
    const location = locations.get(id);
    if (!raw || !location) continue;

    const def = await lookupItem(raw.itemHash);
    if (!def) continue;

    const instance = instancesData[id];
    const sockets = socketsData[id]?.sockets ?? [];
    const stats = statsData[id]?.stats ?? {};

    const perks: PerkRoll[] = [];
    for (let i = 0; i < sockets.length; i++) {
      const s = sockets[i];
      if (typeof s.plugHash !== 'number') continue;
      const plugDef = await lookupItem(s.plugHash);
      const icon = plugDef?.displayProperties?.icon;
      perks.push({
        columnIndex: i,
        plugHash: s.plugHash,
        plugName: plugDef?.displayProperties.name ?? `Plug ${s.plugHash}`,
        plugIcon: icon ? `${BUNGIE_ORIGIN}${icon}` : '',
        isActive: true,
      });
    }

    const statMap: Record<string, number> = {};
    for (const [statHash, entry] of Object.entries(stats)) {
      statMap[statHash] = entry.value;
    }

    const tier: TierType =
      (def.inventory && TIER_TYPE_NAMES[def.inventory.tierType]) ?? 'Unknown';

    const damageTypeHash = instance?.damageType;
    const damageType =
      typeof damageTypeHash === 'number' ? DAMAGE_TYPE_NAMES[damageTypeHash] ?? null : null;

    // parseArmorRoll reads drop.diagnosticDump.sockets to find the archetype
    // and tuning plugs, so armor drops must carry it. Weapons don't need it.
    const isArmor = (def.itemType as ItemType) === ItemType.Armor;
    const needsDump = isArmor && (tier === 'Legendary' || tier === 'Exotic');
    const diagnosticDump = needsDump
      ? await buildArmorDump(def, sockets, stats)
      : undefined;

    drops.push({
      instanceId: id,
      itemHash: raw.itemHash,
      bucketHash: raw.bucketHash,
      name: def.displayProperties.name || `Item ${raw.itemHash}`,
      iconUrl: def.displayProperties.icon ? `${BUNGIE_ORIGIN}${def.displayProperties.icon}` : '',
      itemTypeEnum: def.itemType as ItemType,
      itemSubType: def.itemTypeDisplayName ?? String(def.itemSubType ?? ''),
      tierType: tier,
      damageType,
      perks,
      stats: statMap,
      characterId: location.characterId,
      membershipType,
      isCrafted: (raw.state & ITEM_STATE_CRAFTED) !== 0,
      location: location.containerType,
      detectedAt: Date.now(),
      ...(diagnosticDump ? { diagnosticDump } : {}),
    });
  }

  return drops;
}

async function buildArmorDump(
  itemDef: DestinyInventoryItem,
  sockets: DestinyItemSocket[],
  stats: Record<string, { statHash: number; value: number }>,
): Promise<DiagnosticDropDump> {
  const socketEntries = itemDef.sockets?.socketEntries ?? [];

  const socketDumps: DiagnosticSocketDump[] = [];
  for (let i = 0; i < sockets.length; i++) {
    const s = sockets[i];
    const layoutEntry = socketEntries[i];
    const plugHash = typeof s.plugHash === 'number' ? s.plugHash : null;
    let plugName: string | null = null;
    let plugIcon: string | null = null;
    let plugCategoryIdentifier: string | null = null;
    let plugCategoryHash: number | null = null;
    if (plugHash !== null) {
      const plugDef = await lookupItem(plugHash);
      plugName = plugDef?.displayProperties?.name ?? null;
      const icon = plugDef?.displayProperties?.icon;
      plugIcon = icon ? `${BUNGIE_ORIGIN}${icon}` : null;
      plugCategoryIdentifier = plugDef?.plug?.plugCategoryIdentifier ?? null;
      plugCategoryHash = plugDef?.plug?.plugCategoryHash ?? null;
    }
    socketDumps.push({
      index: i,
      socketTypeHash: layoutEntry?.socketTypeHash ?? 0,
      plugHash,
      plugName,
      plugIcon,
      plugCategoryIdentifier,
      plugCategoryHash,
    });
  }

  const statDumps: DiagnosticStatDump[] = [];
  for (const [, entry] of Object.entries(stats)) {
    const statDef = await lookupStat(entry.statHash);
    const icon = statDef?.displayProperties?.icon;
    statDumps.push({
      statHash: entry.statHash,
      statName: statDef?.displayProperties?.name ?? `stat:${entry.statHash}`,
      statIcon: icon ? `${BUNGIE_ORIGIN}${icon}` : null,
      value: entry.value,
    });
  }

  return {
    itemTypeDisplayName: itemDef.itemTypeDisplayName ?? null,
    collectibleHash: itemDef.collectibleHash ?? null,
    sockets: socketDumps,
    stats: statDumps,
  };
}

function collectRawItems(profile: DestinyProfileResponse): DestinyItemComponent[] {
  const items: DestinyItemComponent[] = [];
  const vaultItems = profile.profileInventory?.data?.items ?? [];
  items.push(...vaultItems);
  for (const bucket of Object.values(profile.characterInventories?.data ?? {})) {
    items.push(...bucket.items);
  }
  for (const bucket of Object.values(profile.characterEquipment?.data ?? {})) {
    items.push(...bucket.items);
  }
  return items;
}
