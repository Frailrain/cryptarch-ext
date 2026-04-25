import { ItemType, type NewItemDrop } from '@/shared/types';
import { evaluateArmorRules } from '@/core/rules/armor-rules';
import { parseArmorRoll } from './armor-roll';
import { evaluateCustomRules } from './custom-rules';
import { matchDropAgainstWishlists } from '@/core/wishlists/matcher';
import type {
  ArmorRoll,
  ArmorRule,
  CustomRule,
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
    armorMatched: null,
    matchedArmorRule: null,
    wishlistMatches: [],
    matchedCustomRule: null,
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
  // Exotic weapons score via wishlists but must NEVER auto-lock. Users
  // manually lock after seeing the notification.
  const isExoticWeapon = drop.tierType === 'Exotic';

  const buildResult = (extras: {
    reasons: string[];
    wishlistMatches?: WishlistMatch[];
    matchedCustomRule?: CustomRule | null;
    isTrash?: boolean;
    autoLock?: boolean;
  }): ScoreResult => {
    const wishlistMatches = extras.wishlistMatches ?? [];
    // Brief #12.5: autolock decided here (per-drop logic) and copied into
    // DropFeedEntry.shouldAutoLock-equivalent via controller. Default: any
    // wishlist keeper match auto-locks unless the weapon is exotic. Custom
    // rule matches don't auto-lock by default — caller can override via
    // extras.autoLock if a future custom-rule UI exposes that.
    const shouldAutoLock =
      extras.autoLock ?? (wishlistMatches.length > 0 && !isExoticWeapon);
    return {
      ...baseResult(armorRoll),
      shouldAutoLock,
      isTrash: extras.isTrash ?? false,
      wishlistMatches,
      matchedCustomRule: extras.matchedCustomRule ?? null,
      reasons: extras.reasons,
    };
  };

  // Custom rules path. The matched rule's `grade` config field is no longer
  // surfaced (Brief #12.5 removed grade from ScoreResult), but the rule still
  // matches and gets recorded in matchedCustomRule for any future feature.
  // Custom rules have no UI to create them, so config.customRules is
  // empty in practice — this path is dormant pending a future rules-editor
  // brief.
  const matchedRule = evaluateCustomRules(drop, config.customRules);
  if (matchedRule) {
    return buildResult({
      matchedCustomRule: matchedRule,
      reasons: [`Matched custom rule: ${matchedRule.name}`],
    });
  }

  // Matcher reads from the in-memory wishlist cache (hydrated at controller
  // startup). The keeperMatches array carries one entry per source whose keeper
  // entries flagged this drop — passed through to DropFeedEntry.wishlistMatches
  // for UI rendering. The winner entry drives the trash-vs-keeper decision
  // (keeper-wins semantics: see matcher.ts docblock for the full rationale).
  const matchResult = matchDropAgainstWishlists(drop, enhancedPerkMap);
  const winnerEntry = matchResult.winner?.entry ?? null;
  if (winnerEntry?.isTrash) {
    return {
      ...baseResult(armorRoll),
      // Trash matches deliberately don't populate wishlistMatches — that array
      // is for keeper-flagged source provenance shown in the Drop Log. Trash
      // is signalled via isTrash + the Trashlist reason string.
      wishlistMatches: [],
      isTrash: true,
      reasons: [`Trashlist match${winnerEntry.notes ? `: ${winnerEntry.notes}` : ''}`],
    };
  }
  if (winnerEntry) {
    return buildResult({
      wishlistMatches: matchResult.keeperMatches,
      reasons: [`Wishlist match${winnerEntry.notes ? `: ${winnerEntry.notes}` : ''}`],
    });
  }

  // Unmatched fallbacks. After grade removal these are just record-keeping —
  // a reason string for the drop's row, no scoring side effects. Notification
  // logic (controller's maybeNotify) gates on wishlistMatches.length > 0 so
  // unmatched drops never fire.
  if (drop.tierType === 'Exotic') return buildResult({ reasons: ['Exotic fallback'] });
  if (drop.tierType === 'Legendary') return buildResult({ reasons: ['Legendary fallback'] });
  if (drop.tierType === 'Rare') return buildResult({ reasons: ['Rare fallback'] });
  return buildResult({ reasons: ['Filtered tier'] });
}
