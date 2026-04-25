import {
  DEFAULT_SCORING_CONFIG,
  type ImportedWishList,
  type ScoringConfig,
} from '@/core/scoring/types';
import { getItem, setItem } from '@/adapters/storage';
import { BUILTIN_WISHLIST_SOURCES } from '@/core/wishlists/known-sources';
import type { WishlistSource } from '@/shared/types';

const SCORING_CONFIG_KEY = 'scoring-config';
const WISHLISTS_KEY = 'wishlists';
const WISHLIST_SOURCES_KEY = 'wishlistSources';

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
  if (stored && stored.length > 0) return stored;
  return BUILTIN_WISHLIST_SOURCES.map((s) => ({ ...s }));
}

export function saveWishlistSources(sources: WishlistSource[]): void {
  setItem<WishlistSource[]>(WISHLIST_SOURCES_KEY, sources);
}
