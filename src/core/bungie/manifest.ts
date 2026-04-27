import {
  STORES,
  idbDelete,
  idbGet,
  idbListKeys,
  idbPut,
} from '@/core/storage/indexeddb';
import { error as logError } from '@/adapters/logger';
import { fetchManifestComponent, getManifestInfo } from './api';
import type { DestinyInventoryItem, DestinyPlugSet, DestinyStat } from './types';

const LOCALE = 'en';
// Brief #14 Part C added DestinyPlugSetDefinition. First boot after the
// upgrade will re-download the manifest because the previously cached version
// doesn't include the new component — users see the manifest loading card
// once. The plug-set table is the source of truth for the random-roll perk
// pool that the perk-pool cache resolves on click.
const COMPONENTS_WE_NEED = [
  'DestinyInventoryItemDefinition',
  'DestinyStatDefinition',
  'DestinyPlugSetDefinition',
] as const;

type ComponentName = (typeof COMPONENTS_WE_NEED)[number];

export interface ManifestCache {
  version: string;
  locale: string;
  definitions: {
    DestinyInventoryItemDefinition: Record<number, DestinyInventoryItem>;
    DestinyStatDefinition: Record<number, DestinyStat>;
    DestinyPlugSetDefinition: Record<number, DestinyPlugSet>;
  };
  downloadedAt: number;
}

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

// Persist a 'ready' flag in chrome.storage so the options page can decide
// whether to show the first-boot loading card. Write directly — the global
// onChanged listener in the storage adapter will update any in-memory cache.
function markManifestReady(): void {
  void chrome.storage.local.set({ 'cryptarch:manifest.ready': true });
}

// Mirror every progress event to chrome.storage so the options-page loading
// card can render real stage/pct feedback instead of an indeterminate spinner.
// Registered unconditionally at module load so both SW and page contexts
// participate — only the SW will actually emit progress, but the write is
// idempotent from either side.
progressListeners.add((p) => {
  void chrome.storage.local.set({ 'cryptarch:manifest.progress': p });
});

let cache: ManifestCache | null = null;
let loadingPromise: Promise<ManifestCache> | null = null;

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

export async function getManifest(): Promise<ManifestCache> {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    emit({ stage: 'checking', pct: 0, version: null });
    const info = await getManifestInfo();
    const version = info.version;

    const existing = await idbGet<ManifestCache>(STORES.manifest, version);
    if (existing) {
      cache = existing;
      markManifestReady();
      emit({ stage: 'done', pct: 100, version });
      return existing;
    }

    const paths = info.jsonWorldComponentContentPaths?.[LOCALE];
    if (!paths) {
      const err = `No manifest paths for locale ${LOCALE}`;
      emit({ stage: 'error', pct: 0, version, error: err });
      throw new Error(err);
    }

    emit({ stage: 'downloading', pct: 0, version });

    const downloaded: Partial<Record<ComponentName, unknown>> = {};
    for (let i = 0; i < COMPONENTS_WE_NEED.length; i++) {
      const name = COMPONENTS_WE_NEED[i];
      const relPath = paths[name];
      if (!relPath) {
        const err = `Missing manifest component path: ${name}`;
        emit({ stage: 'error', pct: 0, version, error: err });
        throw new Error(err);
      }
      downloaded[name] = await fetchManifestComponent<unknown>(relPath);
      emit({
        stage: 'downloading',
        pct: Math.round(((i + 1) / COMPONENTS_WE_NEED.length) * 100),
        version,
      });
    }

    emit({ stage: 'parsing', pct: 100, version });
    const built: ManifestCache = {
      version,
      locale: LOCALE,
      definitions: {
        DestinyInventoryItemDefinition:
          (downloaded.DestinyInventoryItemDefinition as Record<number, DestinyInventoryItem>) ?? {},
        DestinyStatDefinition:
          (downloaded.DestinyStatDefinition as Record<number, DestinyStat>) ?? {},
        DestinyPlugSetDefinition:
          (downloaded.DestinyPlugSetDefinition as Record<number, DestinyPlugSet>) ?? {},
      },
      downloadedAt: Date.now(),
    };

    emit({ stage: 'saving', pct: 50, version });
    await idbPut(STORES.manifest, built, version);

    const keys = await idbListKeys(STORES.manifest);
    for (const k of keys) {
      if (k !== version) await idbDelete(STORES.manifest, k);
    }

    cache = built;
    markManifestReady();
    emit({ stage: 'done', pct: 100, version });
    return built;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export async function lookupItem(hash: number): Promise<DestinyInventoryItem | null> {
  const m = await getManifest();
  return m.definitions.DestinyInventoryItemDefinition[hash] ?? null;
}

export async function lookupStat(hash: number): Promise<DestinyStat | null> {
  const m = await getManifest();
  return m.definitions.DestinyStatDefinition[hash] ?? null;
}

export async function lookupPlugSet(hash: number): Promise<DestinyPlugSet | null> {
  const m = await getManifest();
  return m.definitions.DestinyPlugSetDefinition[hash] ?? null;
}

export function getCachedManifest(): ManifestCache | null {
  return cache;
}

let enhancedPerkMapCache: Map<number, number> | null = null;
let enhancedPerkMapPromise: Promise<Map<number, number>> | null = null;

// TODO: upgrade to plug-identifier-based matching for edge cases (Battery / Barrel false positives)
export function buildEnhancedPerkMap(manifest: ManifestCache): Map<number, number> {
  const map = new Map<number, number>();
  const items = manifest.definitions.DestinyInventoryItemDefinition;

  const baseByName = new Map<string, number>();
  for (const [hashStr, def] of Object.entries(items)) {
    const name = def.displayProperties?.name;
    if (!name || name.startsWith('Enhanced ')) continue;
    if (!baseByName.has(name)) baseByName.set(name, Number(hashStr));
  }

  for (const [hashStr, def] of Object.entries(items)) {
    const name = def.displayProperties?.name;
    if (!name || !name.startsWith('Enhanced ')) continue;
    const baseName = name.slice('Enhanced '.length);
    const baseHash = baseByName.get(baseName);
    if (baseHash !== undefined) map.set(Number(hashStr), baseHash);
  }

  return map;
}

export async function getEnhancedPerkMap(): Promise<Map<number, number>> {
  if (enhancedPerkMapCache) return enhancedPerkMapCache;
  if (enhancedPerkMapPromise) return enhancedPerkMapPromise;
  enhancedPerkMapPromise = (async () => {
    const m = await getManifest();
    const built = buildEnhancedPerkMap(m);
    enhancedPerkMapCache = built;
    return built;
  })();
  try {
    return await enhancedPerkMapPromise;
  } finally {
    enhancedPerkMapPromise = null;
  }
}
