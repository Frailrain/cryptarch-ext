import type { DiagnosticSocketDump, NewItemDrop } from '@/shared/types';
import type { ManifestCache } from '@/core/bungie/manifest';
import { warn } from '@/adapters/logger';
import type { ArmorClass, ArmorRoll, ArmorSlot, ArmorStat } from './types';

const ARMOR_ARCHETYPE_PCID = 'armor_archetypes';
const ARMOR_TUNING_PCID_PREFIX = 'core.gear_systems.armor_tiering.plugs.tuning';
const EMPTY_TUNING_NAME = 'Empty Tuning Mod Socket';

const SLOT_BY_BUCKET: Record<number, ArmorSlot> = {
  3448274439: 'Helmet',
  3551918588: 'Gauntlets',
  14239492: 'Chest',
  20886954: 'Leg',
  1585787867: 'ClassItem',
};

const SET_NAME_SUFFIXES = [
  'Helmet', 'Helm', 'Mask', 'Hood', 'Cowl',
  'Gauntlets', 'Grips', 'Gloves', 'Wraps', 'Grasps',
  'Chestplate', 'Chest Armor', 'Vest', 'Plate', 'Robes',
  'Greaves', 'Strides', 'Boots', 'Legs',
  'Bond', 'Mark', 'Cloak',
];

const TUNING_STAT_NAMES = ['Super', 'Health', 'Grenade', 'Class', 'Weapons', 'Melee'];
const NEW_SYSTEM_STAT_NAMES = new Set(TUNING_STAT_NAMES);

function slotFromBucketHash(bucketHash: number): ArmorSlot | 'Unknown' {
  return SLOT_BY_BUCKET[bucketHash] ?? 'Unknown';
}

function deriveArmorClass(itemSubType: string): ArmorClass | null {
  if (itemSubType.startsWith('Titan')) return 'Titan';
  if (itemSubType.startsWith('Hunter')) return 'Hunter';
  if (itemSubType.startsWith('Warlock')) return 'Warlock';
  return null;
}

function deriveSetName(itemName: string): string {
  for (const suffix of SET_NAME_SUFFIXES) {
    if (itemName.endsWith(' ' + suffix)) {
      return itemName.slice(0, -(suffix.length + 1));
    }
  }
  return itemName;
}

function parseTuningStatName(plugName: string): string | null {
  for (const stat of TUNING_STAT_NAMES) {
    if (plugName.includes(stat)) return stat;
  }
  warn('armor-roll', 'could not parse tuning stat name from plug:', plugName);
  return null;
}

function tierFromTotal(baseTotal: number): 1 | 2 | 3 | 4 | 5 | null {
  if (baseTotal >= 75) return 5;
  if (baseTotal >= 70) return 4;
  if (baseTotal >= 65) return 3;
  if (baseTotal >= 60) return 2;
  if (baseTotal >= 55) return 1;
  return null;
}

function findSocket(
  sockets: DiagnosticSocketDump[],
  predicate: (s: DiagnosticSocketDump) => boolean,
): DiagnosticSocketDump | undefined {
  return sockets.find(predicate);
}

export function parseArmorRoll(drop: NewItemDrop): ArmorRoll {
  const slot = slotFromBucketHash(drop.bucketHash);
  const setName = deriveSetName(drop.name);
  const armorClass = deriveArmorClass(drop.itemSubType ?? '');

  const dump = drop.diagnosticDump;
  const sockets = dump?.sockets ?? [];
  const allStatsList = dump?.stats ?? [];

  const allStats: Record<string, number> = {};
  for (const s of allStatsList) {
    allStats[s.statName] = s.value;
  }

  const archetypeSocket = findSocket(
    sockets,
    (s) => s.plugCategoryIdentifier === ARMOR_ARCHETYPE_PCID,
  );

  // Exotic armor uses the exotic tier (6) and represents its class identity via
  // a pseudo-set value "Exotic" — see listArmorSets below. This way rules can
  // target exotics using the same sets[] array as legendary armor.
  const isExotic = drop.tierType === 'Exotic';
  const setNameForArmor = isExotic ? 'Exotic' : setName;

  if (!archetypeSocket || !archetypeSocket.plugName) {
    return {
      itemHash: drop.itemHash,
      itemInstanceId: drop.instanceId,
      itemName: drop.name,
      slot,
      armorClass,
      setName: setNameForArmor,
      tier: null,
      archetype: null,
      archetypeIcon: null,
      primaryStat: null,
      secondaryStat: null,
      tertiaryStat: null,
      tuningActive: false,
      tuningStatName: null,
      allStats,
      isLegacyArmor: true,
    };
  }

  const archetype = archetypeSocket.plugName;
  const archetypeIcon = archetypeSocket.plugIcon ?? null;

  const tuningSocket = findSocket(
    sockets,
    (s) => s.plugCategoryIdentifier?.startsWith(ARMOR_TUNING_PCID_PREFIX) ?? false,
  );
  const tuningPlugName = tuningSocket?.plugName ?? null;
  const tuningActive = tuningPlugName !== null && tuningPlugName !== EMPTY_TUNING_NAME;
  const tuningStatName = tuningActive && tuningPlugName ? parseTuningStatName(tuningPlugName) : null;

  const ranked: ArmorStat[] = allStatsList
    .filter((s) => NEW_SYSTEM_STAT_NAMES.has(s.statName))
    .map((s) => ({ name: s.statName, value: s.value, icon: s.statIcon }))
    .sort((a, b) => b.value - a.value);

  const primaryStat = ranked[0] ?? null;
  const secondaryStat = ranked[1] ?? null;
  const tertiaryStat = ranked[2] ?? null;

  const total = ranked.reduce((sum, s) => sum + s.value, 0);
  const baseTotal = tuningActive ? total - 5 : total;
  const tier = tierFromTotal(baseTotal);

  return {
    itemHash: drop.itemHash,
    itemInstanceId: drop.instanceId,
    itemName: drop.name,
    slot,
    armorClass,
    setName: setNameForArmor,
    tier,
    archetype,
    archetypeIcon,
    primaryStat,
    secondaryStat,
    tertiaryStat,
    tuningActive,
    tuningStatName,
    allStats,
    isLegacyArmor: false,
  };
}

const ARMOR_ARCHETYPE_SOCKET_TYPE_HASH = 2104613635;

export function listArmorSets(manifest: ManifestCache): string[] {
  const items = manifest.definitions.DestinyInventoryItemDefinition;
  const seen = new Set<string>();
  let sawExotic = false;
  for (const def of Object.values(items)) {
    if (def.itemType !== 2) continue; // Armor only
    const tier = def.inventory?.tierType;
    if (tier === 6) {
      // Exotic armor contributes a single "Exotic" pseudo-set that rules can
      // target to cover any exotic regardless of its specific item name.
      sawExotic = true;
      continue;
    }
    if (tier !== 5) continue; // Legendary
    const socketEntries = def.sockets?.socketEntries;
    if (!socketEntries) continue;
    const isArmor3 = socketEntries.some(
      (e) => e.socketTypeHash === ARMOR_ARCHETYPE_SOCKET_TYPE_HASH,
    );
    if (!isArmor3) continue;
    const name = def.displayProperties?.name;
    if (!name) continue;
    const setName = stripSuffix(name);
    if (setName) seen.add(setName);
  }
  const out = Array.from(seen).sort((a, b) => a.localeCompare(b));
  if (sawExotic) out.unshift('Exotic');
  return out;
}

export function listArmorArchetypes(manifest: ManifestCache): string[] {
  const items = manifest.definitions.DestinyInventoryItemDefinition;
  const seen = new Set<string>();
  for (const def of Object.values(items)) {
    if (def.plug?.plugCategoryIdentifier !== ARMOR_ARCHETYPE_PCID) continue;
    const name = def.displayProperties?.name;
    if (name) seen.add(name);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function stripSuffix(itemName: string): string | null {
  for (const suffix of SET_NAME_SUFFIXES) {
    if (itemName.endsWith(' ' + suffix)) {
      return itemName.slice(0, -(suffix.length + 1));
    }
  }
  return null;
}
