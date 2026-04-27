// Brief #14 Part C — tiered cache for weapon perk pool snapshots. The
// dashboard's expand-on-click view shows "all perks that could have rolled in
// each column", per weapon. Resolving that from the manifest involves walking
// DestinyInventoryItem.sockets.socketEntries → DestinyPlugSet → plug items —
// not free, even with the manifest cached in memory. Once we've resolved a
// given weapon hash against the current manifest, the answer is stable until
// the manifest version changes, so we cache aggressively.
//
// Tier order on read:
//   memory cache → chrome.storage.session → IndexedDB → manifest resolve
//
// Each tier is a strict superset of the slower one in terms of "have we seen
// this snapshot in this session/install/ever", so a hit at any tier short-
// circuits and back-fills the faster tiers above it.
//
// Cache key is `${manifestVersion}:${weaponHash}`. When the manifest updates,
// every old key becomes unreachable (we always look up against the current
// version's prefix). Stale entries linger in IDB until the boot-time sweep
// reaps them; chrome.storage.session evaporates on its own.

import {
  STORES,
  idbDelete,
  idbGet,
  idbListKeys,
  idbPut,
} from '@/core/storage/indexeddb';
import { error as logError } from '@/adapters/logger';
import {
  getCachedManifest,
  getEnhancedPerkMap,
  getManifest,
  lookupItem,
  lookupPlugSet,
} from './manifest';

// Enriched at resolve time so the dashboard can render without ever loading
// the manifest into the page context (the manifest is 30-60 MB; settings page
// deliberately doesn't hold it — see Brief #12.5). Each plug carries its name
// and icon URL alongside the hash, which costs ~80 bytes per plug but
// eliminates the need for a second IPC roundtrip per render.
export interface PerkPoolPlug {
  hash: number;
  name: string;
  iconUrl: string;
  // Brief #14 Part E redesign: shown in the per-perk hover tooltip alongside
  // the name. Populated from manifest displayProperties.description; empty
  // string when the manifest entry has no description (rare).
  description: string;
}

export interface WeaponPerkPoolColumn {
  socketIndex: number;
  plugs: PerkPoolPlug[];
  // Brief #14 Part E redesign: friendly column label ("Barrel" / "Magazine" /
  // "Trait 1" etc.). Derived from the first plug's plugCategoryIdentifier;
  // see labelForCategory below.
  label: string;
}

export interface WeaponPerkPoolSnapshot {
  weaponHash: number;
  manifestVersion: string;
  resolvedAt: string;
  columns: WeaponPerkPoolColumn[];
}

const SESSION_KEY_PREFIX = 'cryptarch:perk-pool:';

const memoryCache = new Map<string, WeaponPerkPoolSnapshot>();
// In-flight guard: parallel calls for the same weapon (idle prewarm racing a
// user click on the same row, or two prewarms from overlapping mounts) share
// one Promise. Without this, we'd burn the resolver twice for nothing.
const inFlight = new Map<string, Promise<WeaponPerkPoolSnapshot | null>>();

// Bump when the resolver's output shape changes (e.g. column filtering rules
// updated, plug fields added/removed). Old cached snapshots become unreachable
// and the boot-time sweep eventually reaps them. Saves us from having to ship
// a manual cache-clear step every time we tweak the resolver.
const CACHE_SCHEMA_VERSION = 9;
function cacheKey(manifestVersion: string, weaponHash: number): string {
  return `v${CACHE_SCHEMA_VERSION}:${manifestVersion}:${weaponHash}`;
}

// Tiered read. Returns the snapshot if any tier has it (and back-fills the
// faster tiers), or runs the resolver against the manifest if no tier does.
// Returns null only when the resolver itself can't produce one — typically
// because the weapon hash isn't in the manifest, or because the manifest is
// unavailable (initial download still in progress, network error, etc.).
export async function getCachedPerkPool(
  weaponHash: number,
): Promise<WeaponPerkPoolSnapshot | null> {
  const manifestVersion = await currentManifestVersion();
  if (!manifestVersion) return null;
  const key = cacheKey(manifestVersion, weaponHash);

  // Fast path: memory hit. No async work, no in-flight bookkeeping needed.
  const fromMemory = memoryCache.get(key);
  if (fromMemory) return fromMemory;

  // Coalesce concurrent misses for the same key onto one promise.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = (async () => {
    const fromSession = await readFromSession(key);
    if (fromSession) {
      memoryCache.set(key, fromSession);
      return fromSession;
    }
    const fromIdb = await readFromIdb(key);
    if (fromIdb) {
      memoryCache.set(key, fromIdb);
      void writeToSession(key, fromIdb);
      return fromIdb;
    }
    const resolved = await resolveFromManifest(weaponHash, manifestVersion);
    if (!resolved) return null;
    memoryCache.set(key, resolved);
    void writeToSession(key, resolved);
    void writeToIdb(key, resolved);
    return resolved;
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

// Resolve a weapon's column-by-column perk pool from the manifest. Public so
// the SW can pre-warm visible rows on dashboard open, but in normal use you
// want getCachedPerkPool — this skips the cache tiers and always walks the
// manifest definitions.
export async function resolveFromManifest(
  weaponHash: number,
  manifestVersion: string,
): Promise<WeaponPerkPoolSnapshot | null> {
  const item = await lookupItem(weaponHash);
  if (!item) return null;
  const socketEntries = item.sockets?.socketEntries ?? [];
  // Bungie's random plug sets often contain BOTH the base and enhanced
  // versions of each perk. The enhanced version has a different hash that
  // doesn't match the controller's canonicalized unlocked set (everything
  // in the entry is base form), so the enhanced variant gets bucketed as
  // "missed" and renders as a phantom duplicate next to its base sibling.
  // Skipping enhanced variants up front gives one canonical entry per perk
  // and keeps display names consistent with the wishlist's base hashes.
  const enhancedToBase = await getEnhancedPerkMap();

  const columns: WeaponPerkPoolColumn[] = [];
  for (let i = 0; i < socketEntries.length; i++) {
    const entry = socketEntries[i];
    // Three sources to try, in order:
    //   1. randomizedPlugSetHash → DestinyPlugSet (random rolls — barrels,
    //      mags, traits, sometimes origin)
    //   2. reusablePlugSetHash → DestinyPlugSet (fixed pools — some origins,
    //      intrinsic frames)
    //   3. reusablePlugItems[] inline on the socket entry (older origin
    //      traits that don't reference a plug set at all)
    // The reusable-category gate below still filters out non-perk sockets
    // that match #2 or #3 (masterworks, mod slots).
    const isRandomized = !!entry.randomizedPlugSetHash;
    let plugItemHashes: number[] = [];
    let currentlyCanRollFilter: ((hash: number) => boolean) | null = null;
    const plugSetHash = entry.randomizedPlugSetHash ?? entry.reusablePlugSetHash;
    if (plugSetHash) {
      const plugSet = await lookupPlugSet(plugSetHash);
      if (!plugSet) continue;
      const allow = new Set(
        plugSet.reusablePlugItems
          .filter((p) => p.currentlyCanRoll)
          .map((p) => p.plugItemHash),
      );
      plugItemHashes = Array.from(allow);
      currentlyCanRollFilter = (h) => allow.has(h);
    } else if (entry.reusablePlugItems && entry.reusablePlugItems.length > 0) {
      // No plug set; the socket carries its plug list inline. No
      // currentlyCanRoll signal at this level — treat every listed plug as
      // valid. The deny-list still kicks out anything cosmetic.
      plugItemHashes = entry.reusablePlugItems.map((p) => p.plugItemHash);
    } else {
      continue;
    }
    if (plugItemHashes.length === 0) continue;
    // currentlyCanRoll filters out perks that exist in the manifest for
    // historical reasons but can't drop in the live sandbox. Matches DIM's
    // behavior — users would otherwise see deprecated perks on every weapon.
    const plugs: PerkPoolPlug[] = [];
    let firstCategory = '';
    const seenHashes = new Set<number>();
    for (const hash of plugItemHashes) {
      if (currentlyCanRollFilter && !currentlyCanRollFilter(hash)) continue;
      // Skip enhanced variants — only the base form of each perk should
      // appear in the column pool. enhancedToBase.get(hash) is defined
      // exactly for enhanced hashes; base hashes pass through.
      if (enhancedToBase.has(hash)) continue;
      // Defensive dedupe: some sockets (notably certain origin trait
      // sockets) list the same plug item twice in their inline pool.
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const def = await lookupItem(hash);
      if (!def) continue;
      const name = def.displayProperties?.name;
      const iconPath = def.displayProperties?.icon;
      if (!name) continue;
      // Safety net: enhancedToBase only catches variants whose base sibling
      // exists with the matching "Enhanced X" → "X" naming convention. Some
      // enhanced perks slip through (variant naming, missing base sibling).
      // A literal name-prefix check catches those without needing the map.
      if (name.startsWith('Enhanced ')) continue;
      // Capture the first surviving plug's category so we can both filter
      // non-perk sockets and label the column. Subsequent plugs in the same
      // pool are usually the same category; using the first is correct in
      // every case I've checked across legendary weapons.
      if (firstCategory === '') {
        firstCategory = def.plug?.plugCategoryIdentifier ?? '';
      }
      plugs.push({
        hash,
        name,
        iconUrl: iconPath ? `https://www.bungie.net${iconPath}` : '',
        description: def.displayProperties?.description ?? '',
      });
    }
    if (plugs.length === 0) continue;
    // Some sockets have randomizedPlugSetHash but aren't actual perk columns
    // (mod slots, masterwork tier selectors, kill trackers, mementos). Cheap
    // identification: peek at the first plug's category. If it matches a
    // known non-perk pattern, skip the column. Deny-list rather than allow-
    // list so new perk types added by Bungie show up by default.
    if (isNonPerkCategory(firstCategory)) continue;
    // Reusable-only sockets: allow the three perk-bearing kinds (origins,
    // intrinsics, frames). Everything else (masterwork tier selectors,
    // mod slots, etc.) is either caught by the deny-list above or filtered
    // here. Skipping reusable sockets without one of these categories
    // prevents phantom columns from arbitrary reusable pools.
    if (!isRandomized && !isPerkBearingReusableCategory(firstCategory)) continue;
    columns.push({
      socketIndex: i,
      plugs,
      label: labelForColumn(firstCategory, isRandomized, plugs.length),
    });
  }

  // Bungie tags trait perks (column 1 + column 2 traits) with the same
  // 'intrinsics' plug category as the actual intrinsic frame. labelForColumn
  // returns "Trait" for randomized intrinsics-categoried columns; here we
  // walk in socket order and number them. A weapon with one Trait column
  // (rare) keeps the bare "Trait" label.
  let traitCounter = 0;
  const traitTotal = columns.filter((c) => c.label === 'Trait').length;
  if (traitTotal > 1) {
    for (const col of columns) {
      if (col.label === 'Trait') {
        traitCounter++;
        col.label = `Trait ${traitCounter}`;
      }
    }
  }

  // Merge columns that ended up with the same label. Some weapons have
  // multiple sockets that all expose the origin trait pool (seasonal +
  // additional origin variants); without this merge they'd render as two
  // identical "Origin Trait" rows. Trait columns are already disambiguated
  // by the numbering above so they don't get collapsed.
  const merged = new Map<string, WeaponPerkPoolColumn>();
  const order: string[] = [];
  for (const col of columns) {
    const existing = merged.get(col.label);
    if (existing) {
      const seen = new Set(existing.plugs.map((p) => p.hash));
      for (const p of col.plugs) {
        if (!seen.has(p.hash)) {
          existing.plugs.push(p);
          seen.add(p.hash);
        }
      }
      // Keep the lower socketIndex so the merged column sorts in its
      // earliest position rather than jumping to a later one.
      if (col.socketIndex < existing.socketIndex) {
        existing.socketIndex = col.socketIndex;
      }
    } else {
      merged.set(col.label, col);
      order.push(col.label);
    }
  }
  const finalColumns = order
    .map((label) => merged.get(label)!)
    .sort((a, b) => a.socketIndex - b.socketIndex);

  if (finalColumns.length === 0) return null;

  return {
    weaponHash,
    manifestVersion,
    resolvedAt: new Date().toISOString(),
    columns: finalColumns,
  };
}

// Drops the `${currentVersion}:` prefix and reaps every IDB entry whose key
// doesn't share that prefix. Called from the SW boot path on idle, so an
// upgrade-then-immediate-click doesn't pay the sweep cost. No-op if no
// manifest yet — first boot has nothing to sweep.
export async function sweepStalePerkPool(): Promise<void> {
  const manifestVersion = await currentManifestVersion();
  if (!manifestVersion) return;
  // Match cacheKey(): keep entries that share BOTH the schema version and the
  // current manifest version. A bump to either one reaps the previous era.
  const prefix = `v${CACHE_SCHEMA_VERSION}:${manifestVersion}:`;
  let keys: IDBValidKey[];
  try {
    keys = await idbListKeys(STORES.perkPool);
  } catch (err) {
    logError('manifest', 'perk-pool sweep listKeys failed', err);
    return;
  }
  let removed = 0;
  for (const k of keys) {
    if (typeof k !== 'string') continue;
    if (k.startsWith(prefix)) continue;
    try {
      await idbDelete(STORES.perkPool, k);
      removed++;
    } catch (err) {
      logError('manifest', 'perk-pool sweep delete failed', { key: k, err });
    }
  }
  if (removed > 0) {
    // Light log; not LogJson because the cardinality is bounded by user
    // session activity, not by a hot loop.
    console.log(`[perk-pool] sweep removed ${removed} stale entries`);
  }
}

// Maps the first plug's plugCategoryIdentifier to a friendly column header.
// Falls back to "Perk" when the identifier doesn't match any known pattern —
// new Bungie weapon archetypes get a sane default rather than a missing label.
//
// "intrinsics" is overloaded by Bungie: it labels both the actual intrinsic
// frame (single-plug, fixed) AND each trait column's pool (multi-plug,
// randomized). We disambiguate by isRandomized + plug count; the
// post-process in resolveFromManifest then numbers multi-trait weapons as
// "Trait 1" / "Trait 2".
function labelForColumn(
  identifier: string,
  isRandomized: boolean,
  plugCount: number,
): string {
  if (!identifier) return 'Perk';
  if (identifier.startsWith('barrels')) return 'Barrel';
  if (identifier.startsWith('tubes')) return 'Tube';
  if (identifier.startsWith('bowstrings')) return 'String';
  if (identifier.startsWith('hafts')) return 'Haft';
  if (identifier.startsWith('blades')) return 'Blade';
  if (identifier.startsWith('scopes')) return 'Scope';
  if (identifier.startsWith('arrows')) return 'Arrow';
  if (identifier.startsWith('grips')) return 'Grip';
  if (identifier.startsWith('stocks')) return 'Stock';
  if (identifier.startsWith('guards')) return 'Guard';
  if (identifier.startsWith('magazines')) return 'Magazine';
  if (identifier === 'origins') return 'Origin Trait';
  if (identifier === 'frames' || identifier === 'intrinsics') {
    // Random multi-plug pool with intrinsics category = a trait column.
    // Single-plug or reusable-only = the actual intrinsic frame.
    if (isRandomized && plugCount > 1) return 'Trait';
    return 'Intrinsic';
  }
  if (identifier.endsWith('perk1')) return 'Trait 1';
  if (identifier.endsWith('perk2')) return 'Trait 2';
  if (identifier.includes('weapon.perk') || identifier.includes('weapon.trait')) return 'Trait';
  return 'Perk';
}

// Categories on reusable-only sockets that count as user-meaningful perk
// columns. Origin traits and the intrinsic frame; nothing else. Masterwork
// tier selectors, kill trackers, mods all have other categories already
// caught by isNonPerkCategory or aren't reusable.
function isPerkBearingReusableCategory(identifier: string): boolean {
  return (
    identifier === 'origins' ||
    identifier === 'intrinsics' ||
    identifier === 'frames'
  );
}

// Plug category substring matches that mark a socket as cosmetic / structural
// rather than a perk column. Conservative — anything outside these patterns
// stays included so new Bungie perk additions don't get filtered out.
function isNonPerkCategory(identifier: string): boolean {
  if (!identifier) return false;
  return (
    identifier.startsWith('v400.empty') ||
    identifier.includes('.weapon.mod_') ||
    identifier.includes('masterwork') ||
    identifier.includes('tracker') ||
    identifier.includes('memento') ||
    identifier === 'shader'
  );
}

async function currentManifestVersion(): Promise<string | null> {
  // Prefer the synchronously-available cached manifest so common-case lookups
  // don't await. If the manifest hasn't been loaded yet (rare — the SW boot
  // kickoff usually wins this race) fall back to the async fetch. Returns
  // null when the manifest fails to load entirely.
  const cached = getCachedManifest();
  if (cached) return cached.version;
  try {
    const m = await getManifest();
    return m.version;
  } catch {
    return null;
  }
}

async function readFromSession(key: string): Promise<WeaponPerkPoolSnapshot | null> {
  try {
    const fullKey = SESSION_KEY_PREFIX + key;
    const result = await chrome.storage.session.get(fullKey);
    const value = result[fullKey] as WeaponPerkPoolSnapshot | undefined;
    return value ?? null;
  } catch {
    // chrome.storage.session can throw if quota is exhausted. Treat as miss;
    // we'll fall through to IDB and the resolver. No noisy log — sessions
    // run for hours and this would be a pure spam path.
    return null;
  }
}

async function writeToSession(
  key: string,
  snapshot: WeaponPerkPoolSnapshot,
): Promise<void> {
  try {
    const fullKey = SESSION_KEY_PREFIX + key;
    await chrome.storage.session.set({ [fullKey]: snapshot });
  } catch {
    // See readFromSession — quota exhaustion is the realistic failure mode
    // here, and it's not actionable from the cache's perspective.
  }
}

async function readFromIdb(key: string): Promise<WeaponPerkPoolSnapshot | null> {
  try {
    return await idbGet<WeaponPerkPoolSnapshot>(STORES.perkPool, key);
  } catch (err) {
    logError('manifest', 'perk-pool IDB read failed', { key, err });
    return null;
  }
}

async function writeToIdb(
  key: string,
  snapshot: WeaponPerkPoolSnapshot,
): Promise<void> {
  try {
    await idbPut(STORES.perkPool, snapshot, key);
  } catch (err) {
    logError('manifest', 'perk-pool IDB write failed', { key, err });
  }
}
