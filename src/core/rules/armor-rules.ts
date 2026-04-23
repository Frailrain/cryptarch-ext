import { getItem, setItem } from '@/adapters/storage';
import type { ArmorClass, ArmorRoll } from '@/core/scoring/types';

const KEY = 'armor-rules';

export const ARMOR_CLASSES: readonly (ArmorClass | 'any')[] = [
  'any',
  'Titan',
  'Hunter',
  'Warlock',
] as const;

export const ARMOR_TERTIARIES: readonly string[] = [
  'Weapons',
  'Health',
  'Grenade',
  'Super',
  'Class',
  'Melee',
] as const;

export interface ArmorRule {
  id: string;
  name: string;
  enabled: boolean;
  class: ArmorClass | 'any';
  sets: string[];
  archetypes: string[];
  tertiaries: string[];
  minTier: 4 | 5;
}

export function loadArmorRules(): ArmorRule[] {
  return getItem<ArmorRule[]>(KEY) ?? [];
}

export function saveArmorRules(rules: ArmorRule[]): void {
  setItem(KEY, rules);
}

export function newRuleId(): string {
  return crypto.randomUUID();
}

export function matchArmorRule(roll: ArmorRoll, rule: ArmorRule): boolean {
  if (!rule.enabled) return false;
  if (roll.isLegacyArmor) return false;
  if (roll.tier === null || roll.tier < rule.minTier) return false;

  if (rule.class !== 'any') {
    if (roll.armorClass !== rule.class) return false;
  }

  if (rule.sets.length > 0) {
    if (!roll.setName || !rule.sets.includes(roll.setName)) return false;
  }

  if (rule.archetypes.length > 0) {
    if (!roll.archetype || !rule.archetypes.includes(roll.archetype)) return false;
  }

  if (rule.tertiaries.length > 0) {
    const tertName = roll.tertiaryStat?.name;
    if (!tertName || !rule.tertiaries.includes(tertName)) return false;
  }

  return true;
}

export interface ArmorMatchResult {
  matched: boolean;
  rule: ArmorRule | null;
}

export function evaluateArmorRules(roll: ArmorRoll, rules: ArmorRule[]): ArmorMatchResult {
  for (const rule of rules) {
    if (matchArmorRule(roll, rule)) return { matched: true, rule };
  }
  return { matched: false, rule: null };
}

export function summarizeRule(rule: ArmorRule): string {
  const cls = rule.class === 'any' ? 'any' : rule.class;
  const sets = rule.sets.length > 0 ? rule.sets.join(', ') : 'any';
  const archs = rule.archetypes.length > 0 ? rule.archetypes.join(', ') : 'any';
  const terts = rule.tertiaries.length > 0 ? rule.tertiaries.join(', ') : 'any';
  return `${cls} ${sets} / ${archs} / ${terts} / T${rule.minTier}+`;
}
