import type { TierFilter, TierLetter } from '@/shared/types';

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

// Brief #20 cleanup: passesRollTypeFilter removed — Brief #19 retired the
// roll-type filter UI, and the matcher now embeds the equivalent logic
// (Charles-as-primary + voltronConfirmation) in matchDropAgainstWishlists.
// passesTierFilter stays — collectWeaponGodrolls still uses it to gate
// non-Charles wishlist sources to the user's selected minTier.
