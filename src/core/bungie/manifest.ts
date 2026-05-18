// Brief #25 — IDB-backed Bungie manifest.
//
// Before this brief: the full DestinyInventoryItemDefinition (~30 k items,
// ~10 KB each, ~300 MB+ inflated) was held as a module-level Record<number, def>
// in the service worker. Every poll cycle's "are we ready" check and every
// `lookupItem(hash)` call dereferenced into this graph. Stop-the-world GC
// pauses when the graph rotated (manifest version bump, or anything that
// rebuilt it) measured 15-30 seconds; rapid wishlist-config clicks could
// transiently double the graph and push SW memory above 8 GB.
//
// After this brief: each definition is its own IDB record keyed by hash.
// The full manifest never lives in JS as a single object graph. Hot-path
// lookups become `await idbGet(STORES.manifestItems, hash)` — a sub-ms
// point query that returns a single ~3-6 KB stripped record. Bulk iterators
// (`iterateItems`) stream via cursor, never materializing the whole table.
// In-memory caches are limited to:
//   - cachedVersion: string | null (~16 bytes)
//   - enhancedPerkMapCache: Map<number, number> (~2k-4k pairs, ~150 KB)
//
// Field stripping at write time drops manifest fields Cryptarch never reads
// (description text, backgroundColor, action, talentGrid, translationBlock,
// loreHash, preview). Saves ~30-40 % of per-item disk size vs raw Bungie
// payload — and more importantly, keeps the IDB transaction buffers small.

import {
  STORES,
  idbBulkPut,
  idbClear,
  idbForEach,
  idbGet,
  idbPut,
  type StoreName,
} from '@/core/storage/indexeddb';
import { error as logError } from '@/adapters/logger';
import { fetchManifestComponent, getManifestInfo } from './api';
import type { DestinyInventoryItem, DestinyPlugSet, DestinyStat } from './types';

const LOCALE = 'en';

const COMPONENTS_WE_NEED = [
  'DestinyInventoryItemDefinition',
  'DestinyStatDefinition',
  'DestinyPlugSetDefinition',
] as const;
type ComponentName = (typeof COMPONENTS_WE_NEED)[number];

// Number of stripped entries per IDB transaction. Bigger = fewer transactions
// (faster) but larger transaction buffers. 250 keeps each transaction below
// ~1.5 MB worth of stripped records, well within IDB sanity.
const BATCH_SIZE = 250;

interface ManifestMeta {
  version: string;
  locale: string;
  downloadedAt: number;
}

// ---------- Progress API (unchanged from pre-#25) ----------

export type ManifestStage =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'parsing'
  | 'saving'
  | 'done'
  | 'error';

export interface ManifestProgress {
  stage: ManifestStage;
  pct: number;
  version: string | null;
  error?: string;
}

type ProgressListener = (p: ManifestProgress) => void;
const progressListeners = new Set<ProgressListener>();

function markManifestReady(): void {
  void chrome.storage.local.set({ 'cryptarch:manifest.ready': true });
}

progressListeners.add((p) => {
  void chrome.storage.local.set({ 'cryptarch:manifest.progress': p });
});

function emit(progress: ManifestProgress): void {
  for (const l of progressListeners) {
    try {
      l(progress);
    } catch (err) {
      logError('manifest', 'listener threw', err);
    }
  }
}

export function onManifestProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  return () => {
    progressListeners.delete(cb);
  };
}

// ---------- Field strippers ----------
//
// Keep only what Cryptarch's runtime actually reads. The TS types in
// `types.ts` already declare a partial view of the Bungie record; these
// strippers enforce that view at write time so unused fields don't sit in
// IDB indefinitely. Strings get re-allocated through the JSON-parse
// boundary so there's no V8 slice-view retention from the parent JSON.

function stripItemDef(raw: unknown): DestinyInventoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hash !== 'number') return null;

  const dp = (r.displayProperties as Record<string, unknown> | undefined) ?? {};
  const stripped: DestinyInventoryItem = {
    hash: r.hash,
    displayProperties: {
      name: typeof dp.name === 'string' ? dp.name : '',
      description: '', // brief #25: drop description, never read at runtime
      hasIcon: dp.hasIcon === true,
    },
    itemType: typeof r.itemType === 'number' ? r.itemType : 0,
    itemSubType: typeof r.itemSubType === 'number' ? r.itemSubType : 0,
  };
  if (typeof dp.icon === 'string') stripped.displayProperties.icon = dp.icon;
  if (typeof r.itemTypeDisplayName === 'string') {
    stripped.itemTypeDisplayName = r.itemTypeDisplayName;
  }
  if (typeof r.itemTypeAndTierDisplayName === 'string') {
    stripped.itemTypeAndTierDisplayName = r.itemTypeAndTierDisplayName;
  }
  const inv = r.inventory as Record<string, unknown> | undefined;
  if (inv && typeof inv === 'object') {
    stripped.inventory = {
      tierType: typeof inv.tierType === 'number' ? inv.tierType : 0,
      tierTypeName: typeof inv.tierTypeName === 'string' ? inv.tierTypeName : '',
      bucketTypeHash: typeof inv.bucketTypeHash === 'number' ? inv.bucketTypeHash : 0,
    };
  }
  if (typeof r.defaultDamageType === 'number') stripped.defaultDamageType = r.defaultDamageType;
  if (typeof r.collectibleHash === 'number') stripped.collectibleHash = r.collectibleHash;

  const sockets = r.sockets as Record<string, unknown> | undefined;
  const socketEntries = sockets?.socketEntries;
  if (Array.isArray(socketEntries)) {
    type SocketEntry = NonNullable<
      NonNullable<DestinyInventoryItem['sockets']>['socketEntries']
    >[number];
    stripped.sockets = {
      socketEntries: socketEntries.map((eRaw: unknown) => {
        const e = (eRaw as Record<string, unknown>) ?? {};
        const out: SocketEntry = {
          socketTypeHash: typeof e.socketTypeHash === 'number' ? e.socketTypeHash : 0,
        };
        if (typeof e.singleInitialItemHash === 'number') {
          out.singleInitialItemHash = e.singleInitialItemHash;
        }
        if (Array.isArray(e.reusablePlugItems)) {
          out.reusablePlugItems = e.reusablePlugItems
            .map((p: unknown) => {
              const pr = (p as Record<string, unknown>) ?? {};
              return typeof pr.plugItemHash === 'number'
                ? { plugItemHash: pr.plugItemHash }
                : null;
            })
            .filter((x): x is { plugItemHash: number } => x !== null);
        }
        if (typeof e.randomizedPlugSetHash === 'number') {
          out.randomizedPlugSetHash = e.randomizedPlugSetHash;
        }
        if (typeof e.reusablePlugSetHash === 'number') {
          out.reusablePlugSetHash = e.reusablePlugSetHash;
        }
        return out;
      }),
    };
  }

  const plug = r.plug as Record<string, unknown> | undefined;
  if (plug && typeof plug === 'object') {
    stripped.plug = {};
    if (typeof plug.plugCategoryIdentifier === 'string') {
      stripped.plug.plugCategoryIdentifier = plug.plugCategoryIdentifier;
    }
    if (typeof plug.plugCategoryHash === 'number') {
      stripped.plug.plugCategoryHash = plug.plugCategoryHash;
    }
  }
  return stripped;
}

function stripStatDef(raw: unknown): DestinyStat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hash !== 'number') return null;
  const dp = (r.displayProperties as Record<string, unknown> | undefined) ?? {};
  const stripped: DestinyStat = {
    hash: r.hash,
    displayProperties: {
      name: typeof dp.name === 'string' ? dp.name : '',
      description: '',
      hasIcon: dp.hasIcon === true,
    },
  };
  if (typeof dp.icon === 'string') stripped.displayProperties.icon = dp.icon;
  return stripped;
}

function stripPlugSetDef(raw: unknown): DestinyPlugSet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.hash !== 'number') return null;
  const items = Array.isArray(r.reusablePlugItems) ? r.reusablePlugItems : [];
  return {
    hash: r.hash,
    reusablePlugItems: items
      .map((p: unknown) => {
        const pr = (p as Record<string, unknown>) ?? {};
        if (typeof pr.plugItemHash !== 'number') return null;
        return {
          plugItemHash: pr.plugItemHash,
          currentlyCanRoll: pr.currentlyCanRoll === true,
        };
      })
      .filter((x): x is { plugItemHash: number; currentlyCanRoll: boolean } => x !== null),
  };
}

// ---------- Write path ----------

type Stripper<T> = (raw: unknown) => T | null;

async function writeComponentToIdb<T>(
  store: StoreName,
  raw: Record<string, unknown>,
  stripper: Stripper<T>,
): Promise<void> {
  let batch: Array<readonly [number, T]> = [];
  for (const [hashStr, def] of Object.entries(raw)) {
    const stripped = stripper(def);
    if (!stripped) continue;
    const hash = Number(hashStr);
    if (!Number.isFinite(hash)) continue;
    batch.push([hash, stripped]);
    if (batch.length >= BATCH_SIZE) {
      await idbBulkPut(store, batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await idbBulkPut(store, batch);
  }
}

// ---------- Public API ----------

let cachedVersion: string | null = null;
let cachedVersionPromise: Promise<string | null> | null = null;
let ensurePromise: Promise<void> | null = null;

/**
 * Idempotent: ensures the per-entry manifest stores in IDB reflect the
 * current Bungie manifest version. No-op when the cached meta version
 * matches Bungie's. Otherwise downloads each component, strips entries,
 * and bulk-writes to IDB. The full parsed component never escapes this
 * function's local scope, so V8 GCs the ~30 MB transient blob after each
 * component finishes writing.
 *
 * Replaces the pre-#25 `getManifest(): Promise<ManifestCache>` whose return
 * value (the full graph) was the source of the memory problem. Callers that
 * previously did `const m = await getManifest(); m.definitions.X[hash]`
 * should switch to `await ensureManifestReady(); await lookupX(hash)`.
 */
export async function ensureManifestReady(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    emit({ stage: 'checking', pct: 0, version: null });

    let info: Awaited<ReturnType<typeof getManifestInfo>>;
    try {
      info = await getManifestInfo();
    } catch (err) {
      emit({
        stage: 'error',
        pct: 0,
        version: null,
        error: err instanceof Error ? err.message : 'Failed to fetch manifest info',
      });
      throw err;
    }
    const bungieVersion = info.version;

    const meta = await idbGet<ManifestMeta>(STORES.manifestMeta, 'current');
    if (meta && meta.version === bungieVersion && meta.locale === LOCALE) {
      cachedVersion = bungieVersion;
      markManifestReady();
      emit({ stage: 'done', pct: 100, version: bungieVersion });
      return;
    }

    const paths = info.jsonWorldComponentContentPaths?.[LOCALE];
    if (!paths) {
      const errMsg = `No manifest paths for locale ${LOCALE}`;
      emit({ stage: 'error', pct: 0, version: bungieVersion, error: errMsg });
      throw new Error(errMsg);
    }

    emit({ stage: 'downloading', pct: 0, version: bungieVersion });

    // Wipe stale entries before writing fresh — partial overlap of old+new
    // versions would make iterateItems return inconsistent results during
    // the upgrade window.
    await idbClear(STORES.manifestItems);
    await idbClear(STORES.manifestStats);
    await idbClear(STORES.manifestPlugSets);
    // Invalidate any derived caches built from the old manifest.
    enhancedPerkMapCache = null;
    enhancedPerkMapPromise = null;

    const componentStores: Record<ComponentName, StoreName> = {
      DestinyInventoryItemDefinition: STORES.manifestItems,
      DestinyStatDefinition: STORES.manifestStats,
      DestinyPlugSetDefinition: STORES.manifestPlugSets,
    };
    // Typed-erased map of stripper per component name. Each writeComponentToIdb
    // call narrows the type per its `store` argument.
    const componentStrippers: Record<ComponentName, Stripper<unknown>> = {
      DestinyInventoryItemDefinition: stripItemDef as Stripper<unknown>,
      DestinyStatDefinition: stripStatDef as Stripper<unknown>,
      DestinyPlugSetDefinition: stripPlugSetDef as Stripper<unknown>,
    };

    for (let i = 0; i < COMPONENTS_WE_NEED.length; i++) {
      const name = COMPONENTS_WE_NEED[i];
      const relPath = paths[name];
      if (!relPath) {
        const errMsg = `Missing manifest component path: ${name}`;
        emit({ stage: 'error', pct: 0, version: bungieVersion, error: errMsg });
        throw new Error(errMsg);
      }
      // Fetch + parse the ~30 MB component. The Record<hash, def> lives
      // in this local scope only. After writeComponentToIdb completes we
      // null the reference so V8 can reclaim the transient blob before
      // the next component starts.
      let downloaded: Record<string, unknown> | null =
        await fetchManifestComponent<Record<string, unknown>>(relPath);
      await writeComponentToIdb(componentStores[name], downloaded, componentStrippers[name]);
      downloaded = null;

      emit({
        stage: 'downloading',
        pct: Math.round(((i + 1) / COMPONENTS_WE_NEED.length) * 100),
        version: bungieVersion,
      });
    }

    // Write meta LAST. Interrupted writes leave meta absent or pointing at
    // the previous version, so the next ensureManifestReady detects the
    // mismatch and retries cleanly.
    emit({ stage: 'saving', pct: 100, version: bungieVersion });
    await idbPut(
      STORES.manifestMeta,
      {
        version: bungieVersion,
        locale: LOCALE,
        downloadedAt: Date.now(),
      } satisfies ManifestMeta,
      'current',
    );

    cachedVersion = bungieVersion;
    markManifestReady();
    emit({ stage: 'done', pct: 100, version: bungieVersion });
  })();
  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}

/**
 * Returns the version string of the manifest currently stored in IDB, or
 * null if the manifest hasn't been downloaded yet. Cheap — reads a single
 * IDB record on first call, then serves from a tiny module-level cache.
 * Used by perk-pool-cache to stamp snapshot keys with a manifest version.
 */
export async function getCurrentManifestVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion;
  if (cachedVersionPromise) return cachedVersionPromise;
  cachedVersionPromise = (async () => {
    const meta = await idbGet<ManifestMeta>(STORES.manifestMeta, 'current');
    if (meta) {
      cachedVersion = meta.version;
      return meta.version;
    }
    return null;
  })();
  try {
    return await cachedVersionPromise;
  } finally {
    cachedVersionPromise = null;
  }
}

export async function lookupItem(hash: number): Promise<DestinyInventoryItem | null> {
  return idbGet<DestinyInventoryItem>(STORES.manifestItems, hash);
}

export async function lookupStat(hash: number): Promise<DestinyStat | null> {
  return idbGet<DestinyStat>(STORES.manifestStats, hash);
}

export async function lookupPlugSet(hash: number): Promise<DestinyPlugSet | null> {
  return idbGet<DestinyPlugSet>(STORES.manifestPlugSets, hash);
}

/**
 * Stream every item definition through the callback via IDB cursor. The
 * caller's callback runs once per item, never holding more than one
 * definition in memory at a time. Used by taxonomy builders (armor sets,
 * armor archetypes) and the enhanced-perk-map builder — anything that
 * needs to scan all 30k items.
 */
export async function iterateItems(cb: (def: DestinyInventoryItem) => void): Promise<void> {
  return idbForEach<DestinyInventoryItem>(STORES.manifestItems, (_key, def) => cb(def));
}

// ---------- Enhanced-perk map (small derived cache) ----------

let enhancedPerkMapCache: Map<number, number> | null = null;
let enhancedPerkMapPromise: Promise<Map<number, number>> | null = null;

// Detects enhanced perks via two patterns Bungie has used over time:
//
//   1. Legacy ("Enhanced X" name): pre-tier-5 era. The enhanced perk is
//      literally named "Enhanced Outlaw" with a base sibling "Outlaw."
//   2. Modern (matching name + "Enhanced *" itemTypeDisplayName): tier 5
//      sandbox era. Both base and enhanced share the SAME name (e.g.
//      "Auto-Loading Holster") and only differ on itemTypeDisplayName
//      ("Enhanced Trait" vs "Trait", "Enhanced Origin Trait" vs "Origin
//      Trait", etc.). The display name was the only field we could find
//      that reliably distinguishes them across all perk categories.
//
// Both patterns map enhanced hash → base hash by name lookup, so the
// downstream canonicalization (controller's `canon` + display model
// normalize) works for either era.
function isEnhancedTypeDisplayName(def: DestinyInventoryItem): boolean {
  return (def.itemTypeDisplayName ?? '').startsWith('Enhanced ');
}

export async function getEnhancedPerkMap(): Promise<Map<number, number>> {
  if (enhancedPerkMapCache) return enhancedPerkMapCache;
  if (enhancedPerkMapPromise) return enhancedPerkMapPromise;
  enhancedPerkMapPromise = (async () => {
    // Two cursor passes. Pass 1: build baseByName from non-enhanced defs.
    // Pass 2: pair enhanced → base by name. Each pass streams one item at
    // a time, so peak transient memory stays in the small-Map range.
    const baseByName = new Map<string, number>();
    await iterateItems((def) => {
      const name = def.displayProperties?.name;
      if (!name) return;
      if (name.startsWith('Enhanced ')) return;
      if (isEnhancedTypeDisplayName(def)) return;
      if (!baseByName.has(name)) baseByName.set(name, def.hash);
    });
    const map = new Map<number, number>();
    await iterateItems((def) => {
      const name = def.displayProperties?.name;
      if (!name) return;
      let baseName: string | null = null;
      if (name.startsWith('Enhanced ')) {
        baseName = name.slice('Enhanced '.length);
      } else if (isEnhancedTypeDisplayName(def)) {
        baseName = name;
      } else {
        return;
      }
      const baseHash = baseByName.get(baseName);
      if (baseHash !== undefined && baseHash !== def.hash) {
        map.set(def.hash, baseHash);
      }
    });
    enhancedPerkMapCache = map;
    return map;
  })();
  try {
    return await enhancedPerkMapPromise;
  } finally {
    enhancedPerkMapPromise = null;
  }
}
