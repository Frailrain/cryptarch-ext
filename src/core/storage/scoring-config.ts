import {
  DEFAULT_SCORING_CONFIG,
  type ImportedWishList,
  type ScoringConfig,
} from '@/core/scoring/types';
import { getItem, setItem } from '@/adapters/storage';
import { BUILTIN_WISHLIST_SOURCES } from '@/core/wishlists/known-sources';
import {
  DEFAULT_WEAPON_FILTER,
  type WeaponFilterConfig,
  type WishlistSource,
} from '@/shared/types';

const SCORING_CONFIG_KEY = 'scoring-config';
const WISHLISTS_KEY = 'wishlists';
const WISHLIST_SOURCES_KEY = 'wishlistSources';
const WEAPON_FILTER_KEY = 'weaponFilterConfig';

// armorRules lives in its own storage key so the scoring-config blob stays
// small. Brief #11 Part D removed the corresponding `wishlists` field from
// ScoringConfig — the matcher reads from the wishlist cache directly now.
type StoredScoringConfig = Omit<ScoringConfig, 'armorRules'>;

export function loadScoringConfig(): ScoringConfig {
  const stored = getItem<StoredScoringConfig>(SCORING_CONFIG_KEY);
  if (!stored) return { ...DEFAULT_SCORING_CONFIG };
  return {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    customRules: stored.customRules ?? [],
    armorRules: [],
  };
}

export function saveScoringConfig(config: ScoringConfig): void {
  const { armorRules: _armorRules, ...rest } = config;
  void _armorRules;
  setItem<StoredScoringConfig>(SCORING_CONFIG_KEY, rest);
}

export function loadWishlists(): ImportedWishList[] {
  return getItem<ImportedWishList[]>(WISHLISTS_KEY) ?? [];
}

export function saveWishlists(lists: ImportedWishList[]): void {
  setItem<ImportedWishList[]>(WISHLISTS_KEY, lists);
}

// Lazy default: if nothing is stored, return a fresh copy of the builtins
// without persisting. Persistence happens only on an explicit saveWishlistSources
// call. Avoids races when popup + Dashboard both load on first run.
//
// Note for future briefs: if we ever ship a new builtin source after #11, this
// helper will need a one-shot merge step so existing users pick it up. Out of
// scope for #11 (we ship 4 builtins and don't change them).
export function loadWishlistSources(): WishlistSource[] {
  const stored = getItem<WishlistSource[]>(WISHLIST_SOURCES_KEY);
  if (!stored || stored.length === 0) {
    return BUILTIN_WISHLIST_SOURCES.map((s) => ({ ...s }));
  }
  // Merge built-in metadata into stored entries by id so post-Brief #11
  // additions (description tweaks, the new pveOriented/pvpOriented flags)
  // reach upgraded users without requiring a one-shot migration. User-
  // controlled fields (enabled) win; static fields (URL, description,
  // orientation) come from the latest builtins. Custom sources pass through
  // unchanged.
  const builtinById = new Map(BUILTIN_WISHLIST_SOURCES.map((b) => [b.id, b]));
  return stored.map((s) => {
    const builtin = builtinById.get(s.id);
    if (!builtin) return s;
    return {
      ...builtin,
      enabled: s.enabled,
    };
  });
}

export function saveWishlistSources(sources: WishlistSource[]): void {
  setItem<WishlistSource[]>(WISHLIST_SOURCES_KEY, sources);
}

// Brief #12: Weapons-tab filter config (tier threshold + roll-type mode).
// Independent of wishlistSources so toggling sources doesn't churn this key.
export function loadWeaponFilterConfig(): WeaponFilterConfig {
  const stored = getItem<WeaponFilterConfig>(WEAPON_FILTER_KEY);
  if (!stored) return { ...DEFAULT_WEAPON_FILTER };
  // Merge with defaults so a partial stored config (after future field
  // additions in subsequent briefs) still returns a complete object.
  return { ...DEFAULT_WEAPON_FILTER, ...stored };
}

export function saveWeaponFilterConfig(config: WeaponFilterConfig): void {
  setItem<WeaponFilterConfig>(WEAPON_FILTER_KEY, config);
}
