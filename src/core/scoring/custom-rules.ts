import { ItemType, type NewItemDrop } from '@/shared/types';
import type { CustomRule } from './types';

export function evaluateCustomRules(
  drop: NewItemDrop,
  rules: CustomRule[],
): CustomRule | null {
  if (drop.itemTypeEnum === ItemType.Armor) return null;

  for (const rule of rules) {
    if (matchesWeaponRule(drop, rule)) return rule;
  }
  return null;
}

function matchesWeaponRule(drop: NewItemDrop, rule: CustomRule): boolean {
  if (rule.weaponNames?.length && !rule.weaponNames.includes(drop.name)) return false;
  if (rule.frames?.length && !rule.frames.includes(drop.itemSubType)) return false;
  if (rule.isCrafted !== undefined && rule.isCrafted !== drop.isCrafted) return false;

  if (rule.perks?.length) {
    const activePerkNames = new Set<string>();
    for (const p of drop.perks) {
      if (p.isActive) activePerkNames.add(p.plugName);
    }
    for (const required of rule.perks) {
      if (!activePerkNames.has(required)) return false;
    }
  }

  return true;
}
