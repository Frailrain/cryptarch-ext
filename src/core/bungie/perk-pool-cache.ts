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
import { getCachedManifest, getManifest, lookupItem, lookupPlugSet } from './manifest';

// Enriched at resolve time so the dashboard can render without ever loading
// the manifest into the page context (the manifest is 30-60 MB; settings page
// deliberately doesn't hold it — see Brief #12.5). Each plug carries its name
// and icon URL alongside the hash, which costs ~80 bytes per plug but
// eliminates the need for a second IPC roundtrip per render.
export interface PerkPoolPlug {
  hash: number;
  name: string;
  iconUrl: string;
}

export interface WeaponPerkPoolColumn {
  socketIndex: number;
  plugs: PerkPoolPlug[];
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

function cacheKey(manifestVersion: string, weaponHash: number): string {
  return `${manifestVersion}:${weaponHash}`;
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

  const columns: WeaponPerkPoolColumn[] = [];
  for (let i = 0; i < socketEntries.length; i++) {
    const entry = socketEntries[i];
    // Random-roll perk columns are the ones with randomizedPlugSetHash.
    // reusablePlugSetHash exists on fixed-roll sockets (e.g. masterworks,
    // some adept perks) but those aren't part of the user-facing "what
    // could have rolled here" question. Skip them.
    if (!entry.randomizedPlugSetHash) continue;
    const plugSet = await lookupPlugSet(entry.randomizedPlugSetHash);
    if (!plugSet) continue;
    // currentlyCanRoll filters out perks that exist in the manifest for
    // historical reasons but can't drop in the live sandbox. Matches DIM's
    // behavior — users would otherwise see deprecated perks on every weapon.
    const plugs: PerkPoolPlug[] = [];
    for (const p of plugSet.reusablePlugItems) {
      if (!p.currentlyCanRoll) continue;
      const def = await lookupItem(p.plugItemHash);
      if (!def) continue;
      const name = def.displayProperties?.name;
      const iconPath = def.displayProperties?.icon;
      if (!name) continue;
      plugs.push({
        hash: p.plugItemHash,
        name,
        iconUrl: iconPath ? `https://www.bungie.net${iconPath}` : '',
      });
    }
    if (plugs.length === 0) continue;
    columns.push({ socketIndex: i, plugs });
  }

  if (columns.length === 0) return null;

  return {
    weaponHash,
    manifestVersion,
    resolvedAt: new Date().toISOString(),
    columns,
  };
}

// Drops the `${currentVersion}:` prefix and reaps every IDB entry whose key
// doesn't share that prefix. Called from the SW boot path on idle, so an
// upgrade-then-immediate-click doesn't pay the sweep cost. No-op if no
// manifest yet — first boot has nothing to sweep.
export async function sweepStalePerkPool(): Promise<void> {
  const manifestVersion = await currentManifestVersion();
  if (!manifestVersion) return;
  const prefix = `${manifestVersion}:`;
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
