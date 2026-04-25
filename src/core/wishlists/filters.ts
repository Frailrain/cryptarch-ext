import type {
  RollTypeFilter,
  TierFilter,
  TierLetter,
  WishlistMatch,
  WishlistSource,
} from '@/shared/types';

// Tier ordering for filter comparisons. Index 0 is best (S), 5 is worst (F).
// Mirrors TIER_ORDER in matcher.ts but as a lookup record for O(1) rank checks.
const TIER_RANK: Record<TierLetter, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  F: 5,
};

/**
 * Tier filter: true if the drop's resolved tier is at or better than the
 * configured threshold. Drops without weaponTier (Voltron-only matches that
 * don't reference an Aegis tier, custom URLs without tier metadata) pass
 * only when the threshold is 'all'.
 *
 * Brief #12 reasoning for the fail-closed default on untiered drops: a user
 * who opts for tier-filtered notifications has implicitly opted out of
 * "we don't know how good this weapon is" alerts. The fix is either to
 * enable an Aegis source (which adds tier data) or set the filter to 'all'.
 * The Weapons-tab UI surfaces a soft warning when this configuration is
 * detected.
 */
export function passesTierFilter(
  weaponTier: TierLetter | undefined,
  filter: TierFilter,
): boolean {
  if (filter === 'all') return true;
  if (!weaponTier) return false;
  return TIER_RANK[weaponTier] <= TIER_RANK[filter];
}

/**
 * Roll-type filter: true if the drop's matches satisfy the active filter
 * mode. All modes require at least one match — a drop with no matches
 * doesn't pass any roll-type filter (it shouldn't fire a notification at
 * all if nothing flagged it).
 *
 *   - 'all-matched': any source matched → pass
 *   - 'popular':     2+ sources matched → pass (Brief #11 consensus signal)
 *   - 'strong-pve':  at least one matching source has pveOriented=true → pass
 *
 * 'strong-pvp' deliberately absent — no acceptable PVP source exists as of
 * Brief #12. See the header comment in known-sources.ts.
 */
export function passesRollTypeFilter(
  matches: WishlistMatch[] | undefined,
  filter: RollTypeFilter,
  sources: WishlistSource[],
): boolean {
  const list = matches ?? [];
  if (list.length === 0) return false;
  if (filter === 'all-matched') return true;
  if (filter === 'popular') return list.length >= 2;
  if (filter === 'strong-pve') {
    const pveIds = new Set(
      sources.filter((s) => s.pveOriented).map((s) => s.id),
    );
    return list.some((m) => pveIds.has(m.sourceId));
  }
  return false;
}
