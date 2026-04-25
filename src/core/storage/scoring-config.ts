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
  type WishlistMetadata,
  type WishlistSource,
} from '@/shared/types';

const SCORING_CONFIG_KEY = 'scoring-config';
const WISHLISTS_KEY = 'wishlists';
const WISHLIST_METADATA_KEY = 'wishlistMetadata';
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

// Brief #12.5 Part D: every saveWishlists write also derives and persists the
// lightweight metadata view, keeping the two storage keys in sync without
// callers having to remember. The settings page reads metadata-only and
// avoids pulling 60 MB of parsed entries through IPC.
export function saveWishlists(lists: ImportedWishList[]): void {
  setItem<ImportedWishList[]>(WISHLISTS_KEY, lists);
  setItem<WishlistMetadata[]>(
    WISHLIST_METADATA_KEY,
    lists.map((l) => ({
      id: l.id,
      name: l.name,
      sourceUrl: l.sourceUrl,
      entryCount: l.entryCount,
      importedAt: l.importedAt,
    })),
  );
}

// Brief #12.5 Part D: settings page reads this instead of loadWishlists.
// Pure read — no migration fallback. The previous version fell back to
// loadWishlists() to derive metadata when the key was missing, but that
// re-introduced the very 60 MB read we're trying to avoid in page contexts.
// SW now derives metadata on its own hydrate (cache.ts syncMetadataFromCache),
// so by the time any dashboard reads, metadata is populated.
export function loadWishlistMetadata(): WishlistMetadata[] {
  return getItem<WishlistMetadata[]>(WISHLIST_METADATA_KEY) ?? [];
}

// Direct metadata write. Called by the SW's syncMetadataFromCache when it
// detects metadata is stale relative to the full wishlists cache. saveWishlists
// also writes metadata (as a derived view of what it's persisting), so most
// updates flow through there; this exists for the SW-side derive path that
// shouldn't re-write the heavy wishlists key.
export function saveWishlistMetadata(meta: WishlistMetadata[]): void {
  setItem<WishlistMetadata[]>(WISHLIST_METADATA_KEY, meta);
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
