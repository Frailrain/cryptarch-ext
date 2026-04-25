import { ItemType, type NewItemDrop } from '@/shared/types';
import { evaluateArmorRules } from '@/core/rules/armor-rules';
import { parseArmorRoll } from './armor-roll';
import { evaluateCustomRules } from './custom-rules';
import { matchDropAgainstWishlists } from '@/core/wishlists/matcher';
import type {
  ArmorRoll,
  ArmorRule,
  CustomRule,
  Grade,
  ScoreResult,
  ScoringConfig,
} from './types';
import type { WishlistMatch } from '@/shared/types';

function describeArmorRoll(roll: ArmorRoll): string {
  if (roll.isLegacyArmor) return 'legacy armor';
  const cls = roll.armorClass ?? '?';
  const set = roll.setName ?? '?';
  const arch = roll.archetype ?? '?';
  const tert = roll.tertiaryStat?.name ?? '?';
  const tier = roll.tier ?? '?';
  return `armor: ${cls} ${set} / ${arch} / ${tert}, tier ${tier}`;
}

function baseResult(armorRoll: ArmorRoll | null): ScoreResult {
  return {
    grade: null,
    armorMatched: null,
    matchedArmorRule: null,
    wishlistMatches: [],
    matchedCustomRule: null,
    shouldAlert: false,
    shouldAutoLock: false,
    isTrash: false,
    excluded: false,
    reasons: [],
    armorRoll,
  };
}

export function scoreItem(
  drop: NewItemDrop,
  config: ScoringConfig,
  enhancedPerkMap: Map<number, number>,
): ScoreResult {
  if (drop.instanceId.startsWith('synthetic-')) {
    return {
      ...baseResult(null),
      grade: 'S',
      shouldAlert: true,
      shouldAutoLock: true,
      reasons: ['Wishlist match (synthetic)'],
    };
  }

  const isArmorTier =
    drop.itemTypeEnum === ItemType.Armor &&
    (drop.tierType === 'Legendary' || drop.tierType === 'Exotic');
  const armorRoll: ArmorRoll | null = isArmorTier ? parseArmorRoll(drop) : null;

  if (config.excludeCrafted && drop.isCrafted) {
    return {
      ...baseResult(armorRoll),
      excluded: true,
      reasons: ['Crafted — excluded'],
    };
  }

  if (drop.itemTypeEnum === ItemType.Armor) {
    return scoreArmor(drop, armorRoll, config);
  }

  return scoreWeapon(drop, armorRoll, config, enhancedPerkMap);
}

function scoreArmor(
  drop: NewItemDrop,
  armorRoll: ArmorRoll | null,
  config: ScoringConfig,
): ScoreResult {
  // Rare armor and anything that didn't parse: excluded.
  if (!armorRoll || (drop.tierType !== 'Legendary' && drop.tierType !== 'Exotic')) {
    return {
      ...baseResult(armorRoll),
      excluded: true,
      reasons: [`${drop.tierType} armor — excluded`],
    };
  }

  if (armorRoll.isLegacyArmor) {
    return {
      ...baseResult(armorRoll),
      excluded: true,
      reasons: ['Legacy armor — excluded'],
    };
  }

  // For legendary armor the tier floor of 4 still applies. Exotic armor bypasses
  // the tier floor because rules targeting "Exotic" should match regardless of
  // roll quality; users who care about tier can add a minTier constraint.
  if (drop.tierType === 'Legendary') {
    if (armorRoll.tier === null || armorRoll.tier < 4) {
      return {
        ...baseResult(armorRoll),
        excluded: true,
        reasons: [`Tier ${armorRoll.tier ?? '?'} — excluded`],
      };
    }
  }

  const enabledRules: ArmorRule[] = config.armorRules.filter((r) => r.enabled);
  const { matched, rule } = evaluateArmorRules(armorRoll, enabledRules);

  const reason = matched && rule
    ? `Matched rule: ${rule.name || summarizeInlineRule(rule)}, ${describeArmorRoll(armorRoll)}`
    : `No rule match, ${describeArmorRoll(armorRoll)}`;

  return {
    ...baseResult(armorRoll),
    armorMatched: matched,
    matchedArmorRule: rule,
    shouldAlert: matched,
    shouldAutoLock: matched && config.autoLockOnArmorMatch,
    reasons: [reason],
  };
}

function summarizeInlineRule(rule: ArmorRule): string {
  const parts: string[] = [];
  if (rule.class !== 'any') parts.push(rule.class);
  if (rule.sets.length) parts.push(rule.sets.join('|'));
  if (rule.archetypes.length) parts.push(rule.archetypes.join('|'));
  if (rule.tertiaries.length) parts.push(rule.tertiaries.join('|'));
  parts.push(`T${rule.minTier}+`);
  return parts.join(' / ');
}

function scoreWeapon(
  drop: NewItemDrop,
  armorRoll: ArmorRoll | null,
  config: ScoringConfig,
  enhancedPerkMap: Map<number, number>,
): ScoreResult {
  const buildResult = (
    grade: Grade | null,
    extras: {
      reasons: string[];
      wishlistMatches?: WishlistMatch[];
      matchedCustomRule?: CustomRule | null;
      isTrash?: boolean;
    },
  ): ScoreResult => {
    const shouldAlert = (() => {
      if (!grade) return false;
      if (grade === 'F') return false;
      if (config.alertThreshold === 'S') return grade === 'S';
      if (config.alertThreshold === 'SA') return grade === 'S' || grade === 'A';
      return true;
    })();
    // Exotic weapons score via Voltron but must NEVER auto-lock. Users can
    // manually lock after seeing the notification.
    const isExoticWeapon = drop.tierType === 'Exotic';
    return {
      ...baseResult(armorRoll),
      grade,
      shouldAlert,
      shouldAutoLock: grade === 'S' && !isExoticWeapon,
      isTrash: extras.isTrash ?? false,
      wishlistMatches: extras.wishlistMatches ?? [],
      matchedCustomRule: extras.matchedCustomRule ?? null,
      reasons: extras.reasons,
    };
  };

  const matchedRule = evaluateCustomRules(drop, config.customRules);
  if (matchedRule) {
    return buildResult(matchedRule.grade, {
      matchedCustomRule: matchedRule,
      reasons: [`Matched custom rule: ${matchedRule.name}`],
    });
  }

  // Matcher reads from the in-memory wishlist cache (hydrated at controller
  // startup). The keeperMatches array carries one entry per source whose keeper
  // entries flagged this drop — passed through to DropFeedEntry.wishlistMatches
  // for UI rendering. The winner entry drives the grade decision (keeper-wins
  // semantics: see matcher.ts docblock for the full rationale).
  const matchResult = matchDropAgainstWishlists(drop, enhancedPerkMap);
  const winnerEntry = matchResult.winner?.entry ?? null;
  if (winnerEntry?.isTrash) {
    return {
      ...baseResult(armorRoll),
      grade: 'D',
      // Trash matches deliberately don't populate wishlistMatches — that array
      // is for keeper-flagged source provenance shown in the Drop Log. Trash is
      // signalled to the user via the D grade and the Trashlist reason string.
      wishlistMatches: [],
      isTrash: true,
      reasons: [`Trashlist match${winnerEntry.notes ? `: ${winnerEntry.notes}` : ''}`],
    };
  }
  if (winnerEntry) {
    return buildResult('S', {
      wishlistMatches: matchResult.keeperMatches,
      reasons: [`Wishlist match${winnerEntry.notes ? `: ${winnerEntry.notes}` : ''}`],
    });
  }

  if (drop.tierType === 'Exotic') {
    return buildResult('A', { reasons: ['Exotic fallback'] });
  }
  if (drop.tierType === 'Legendary') {
    return buildResult('B', { reasons: ['Legendary fallback'] });
  }
  if (drop.tierType === 'Rare') {
    return buildResult('C', { reasons: ['Rare fallback'] });
  }
  return buildResult(null, { reasons: ['Filtered tier'] });
}
