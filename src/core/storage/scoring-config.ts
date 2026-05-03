import {
  DEFAULT_SCORING_CONFIG,
  type ImportedWishList,
  type ScoringConfig,
} from '@/core/scoring/types';
import { getItem, removeItem, setItem } from '@/adapters/storage';
import { STORES, idbGet, idbPut } from '@/core/storage/indexeddb';
import {
  BUILTIN_WISHLIST_SOURCES,
  CHARLES_SOURCE_ID,
  computeCharlesUrl,
} from '@/core/wishlists/known-sources';
import {
  DEFAULT_CHARLES_CONFIG,
  DEFAULT_WEAPON_FILTER,
  type CharlesSourceConfig,
  type TierLetter,
  type WeaponFilterConfig,
  type WeaponFilterConfigLegacy,
  type WishlistMetadata,
  type WishlistSource,
} from '@/shared/types';

const SCORING_CONFIG_KEY = 'scoring-config';
const WISHLISTS_KEY = 'wishlists';
const WISHLIST_METADATA_KEY = 'wishlistMetadata';
const WISHLIST_SOURCES_KEY = 'wishlistSources';
const WEAPON_FILTER_KEY = 'weaponFilterConfig';
const CHARLES_CONFIG_KEY = 'charlesSourceConfig';

// Brief #24: parsed wishlists live in IndexedDB now (see indexeddb.ts comment
// on DB_VERSION 3). Pre-#24 builds wrote them to chrome.storage.local under
// WISHLISTS_KEY, which broadcast the full payload to every extension page on
// every write. The IDB store uses a single key to hold the whole array.
const WISHLISTS_IDB_KEY = 'all';

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

// Brief #24: read from IndexedDB. Migration of pre-#24 chrome.storage.local
// data lives in cache.ts hydrateWishlistCache (the only caller) — keeping the
// migration adjacent to the in-memory cache state means the migration runs
// exactly when the Map is being populated, no separate boot hook needed.
export async function loadWishlists(): Promise<ImportedWishList[]> {
  const stored = await idbGet<ImportedWishList[]>(STORES.wishlists, WISHLISTS_IDB_KEY);
  return stored ?? [];
}

// Brief #12.5 Part D: every saveWishlists write also derives and persists the
// lightweight metadata view, keeping the two storage keys in sync without
// callers having to remember. The settings page reads metadata-only and
// avoids pulling 60 MB of parsed entries through IPC.
//
// Brief #24: the heavy entries blob now goes to IndexedDB (no cross-context
// broadcast). Metadata stays in chrome.storage.local because it's small
// (~hundreds of bytes) and the dashboard subscribes to it via onKeyChanged
// for live UI updates.
export async function saveWishlists(lists: ImportedWishList[]): Promise<void> {
  await idbPut<ImportedWishList[]>(STORES.wishlists, lists, WISHLISTS_IDB_KEY);
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

// Brief #24 migration helper. Called once during cache hydrate. If the legacy
// chrome.storage.local 'wishlists' key still exists, copy it to IDB and remove
// it from chrome.storage.local. Idempotent — second call finds the key gone
// and no-ops. Returns the migrated lists so the hydrate path can use them
// without a second round trip.
export async function migrateWishlistsFromChromeStorage(): Promise<
  ImportedWishList[] | null
> {
  const legacy = getItem<ImportedWishList[]>(WISHLISTS_KEY);
  if (!legacy || legacy.length === 0) return null;
  await idbPut<ImportedWishList[]>(STORES.wishlists, legacy, WISHLISTS_IDB_KEY);
  // Removing from chrome.storage.local fires one final onChanged event with
  // the full oldValue. That's a one-time spike for any open dashboard, but
  // it's the only way to free the chrome.storage allocation.
  removeItem(WISHLISTS_KEY);
  return legacy;
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
export function loadWishlistSources(): WishlistSource[] {
  const stored = getItem<WishlistSource[]>(WISHLIST_SOURCES_KEY);
  if (!stored || stored.length === 0) {
    return BUILTIN_WISHLIST_SOURCES.map((s) => ({ ...s }));
  }
  // Brief #21: built-in source state is no longer user-toggleable. Charles
  // is always on; Voltron + Choosy Voltron always on (Weapons tab toggle
  // gates whether they contribute to scoring); deprecated Aegis sources
  // always off. Loader takes the built-in's declared `enabled` verbatim
  // and discards any user-toggled state from storage. Custom sources keep
  // their user-set enabled and acquire notificationOnly=true on first read
  // (defaults to true for custom URLs added pre-#21).
  const builtinById = new Map(BUILTIN_WISHLIST_SOURCES.map((b) => [b.id, b]));
  const storedIds = new Set(stored.map((s) => s.id));
  const result: WishlistSource[] = stored.map((s) => {
    const builtin = builtinById.get(s.id);
    if (!builtin) {
      // Custom source — preserve user state, default notificationOnly=true.
      return { ...s, notificationOnly: s.notificationOnly ?? true };
    }
    return { ...builtin };
  });
  // Brief #18: append any built-in id missing from stored. Picks up new
  // sources shipped after the user's first install without requiring storage
  // clear. New built-ins arrive with their declared `enabled` default.
  for (const b of BUILTIN_WISHLIST_SOURCES) {
    if (!storedIds.has(b.id)) {
      result.push({ ...b });
    }
  }
  // Brief #19: configurable sources (currently only Charles) get their URL
  // recomputed from the live config blob. Keeps fetch.ts URL-agnostic — it
  // always reads source.url, never knows whether the source is configurable.
  const charlesConfig = loadCharlesSourceConfig();
  return result.map((s) => {
    if (s.id === CHARLES_SOURCE_ID && s.configurable) {
      return { ...s, url: computeCharlesUrl(charlesConfig) };
    }
    return s;
  });
}

export function saveWishlistSources(sources: WishlistSource[]): void {
  setItem<WishlistSource[]>(WISHLIST_SOURCES_KEY, sources);
}

// Brief #19: WeaponFilterConfig now holds only voltronConfirmation. The
// pre-#19 tier/roll-type fields move to charlesSourceConfig. Read-time
// adapter accepts the legacy shape and merges sane defaults; the migrated
// view is returned to callers but NOT written back here — callers (or a
// future settings save) get the persisted upgrade for free on next save.
export function loadWeaponFilterConfig(): WeaponFilterConfig {
  const stored = getItem<WeaponFilterConfigLegacy>(WEAPON_FILTER_KEY);
  if (!stored) return { ...DEFAULT_WEAPON_FILTER };
  return {
    ...DEFAULT_WEAPON_FILTER,
    voltronConfirmation:
      stored.voltronConfirmation ?? DEFAULT_WEAPON_FILTER.voltronConfirmation,
  };
}

export function saveWeaponFilterConfig(config: WeaponFilterConfig): void {
  setItem<WeaponFilterConfig>(WEAPON_FILTER_KEY, config);
}

// Brief #19: Charles selector config. Stored under its own key so
// independent components (Weapons tab UI, fetch URL injection, matcher
// tier scoping) all read the same source of truth without touching
// WeaponFilterConfig or wishlistSources. Migration: if charlesSourceConfig
// is missing but legacy WeaponFilterConfig exists, derive minTier from
// the old tierFilter ('S'/'A' map directly; everything else → 'F' for
// most-permissive coverage). PPC defaults to 0 (any roll), preserving
// the pre-#19 notification volume since the old roll-type filter didn't
// gate on perk strictness.
export function loadCharlesSourceConfig(): CharlesSourceConfig {
  const stored = getItem<CharlesSourceConfig>(CHARLES_CONFIG_KEY);
  if (stored) {
    return {
      minTier: stored.minTier ?? DEFAULT_CHARLES_CONFIG.minTier,
      ppc: stored.ppc ?? DEFAULT_CHARLES_CONFIG.ppc,
    };
  }
  // No new-format config yet — migrate from legacy WeaponFilterConfig if
  // present. Returns the migrated view; no persistence (the next explicit
  // saveCharlesSourceConfig call writes the upgraded form).
  const legacy = getItem<WeaponFilterConfigLegacy>(WEAPON_FILTER_KEY);
  if (!legacy) return { ...DEFAULT_CHARLES_CONFIG };
  return {
    minTier: legacyTierToCharlesMinTier(legacy.tierFilter),
    ppc: 0,
  };
}

export function saveCharlesSourceConfig(config: CharlesSourceConfig): void {
  setItem<CharlesSourceConfig>(CHARLES_CONFIG_KEY, config);
}

function legacyTierToCharlesMinTier(
  tier: string | undefined,
): CharlesSourceConfig['minTier'] {
  // Direct mapping for tier letters Charles supports; 'all' and missing
  // both default to F (most permissive — matches DEFAULT_CHARLES_CONFIG and
  // preserves the notification surface area for users who hadn't tightened
  // the pre-#19 tier filter).
  const direct: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];
  if (tier && (direct as string[]).includes(tier)) {
    return tier as CharlesSourceConfig['minTier'];
  }
  return DEFAULT_CHARLES_CONFIG.minTier;
}
