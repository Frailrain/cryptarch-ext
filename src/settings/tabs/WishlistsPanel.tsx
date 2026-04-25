import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WishlistSource } from '@/shared/types';
import type { ImportedWishList } from '@/core/scoring/types';
import {
  loadWishlistSources,
  saveWishlistSources,
  loadWishlists,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
import { refreshOne, refreshWishlists, validateWishlistUrl } from '@/core/wishlists/fetch';

// Per-source UI state machine. The persisted FetchStatus in cache.ts only lives
// in the service worker context; the settings page tracks its own ephemeral
// status here, scoped to refreshes the user initiates from this tab.
type RowState =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'error'; message: string };

export function WishlistsPanel() {
  const [sources, setSources] = useState<WishlistSource[]>(() => loadWishlistSources());
  const [cachedLists, setCachedLists] = useState<ImportedWishList[]>(() => loadWishlists());
  const [rowStates, setRowStates] = useState<Map<string, RowState>>(new Map());
  const [refreshAllPending, setRefreshAllPending] = useState(false);
  const [refreshAllToast, setRefreshAllToast] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Custom URL form state.
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [validating, setValidating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Cross-context sync: SW background refresh writes to the wishlists key when a
  // fetch lands. Subscribing here lets the UI reflect the new entry counts and
  // last-updated timestamps without a manual refresh.
  useEffect(() => {
    const unsub1 = onKeyChanged<ImportedWishList[]>('wishlists', (v) => {
      setCachedLists(v ?? []);
    });
    const unsub2 = onKeyChanged<WishlistSource[]>('wishlistSources', (v) => {
      if (v) setSources(v);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  // Tick once a minute for relative-time labels. Cheap; only the visible labels
  // re-render.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // On mount, kick a stale-only refresh of enabled sources. The 24h staleness
  // check inside refreshOne short-circuits sources that are still fresh, so
  // opening the tab repeatedly is cheap.
  useEffect(() => {
    void refreshWishlists(loadWishlistSources()).catch(() => {});
    // Intentionally empty deps — once-on-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cacheById = useMemo(() => {
    const m = new Map<string, ImportedWishList>();
    for (const list of cachedLists) m.set(list.id, list);
    return m;
  }, [cachedLists]);

  const persistSources = useCallback((next: WishlistSource[]) => {
    setSources(next);
    saveWishlistSources(next);
  }, []);

  const setRowState = useCallback((id: string, state: RowState) => {
    setRowStates((prev) => {
      const next = new Map(prev);
      next.set(id, state);
      return next;
    });
  }, []);

  const handleToggle = useCallback(
    async (source: WishlistSource, enabled: boolean) => {
      const next = sources.map((s) => (s.id === source.id ? { ...s, enabled } : s));
      persistSources(next);
      // Fetch immediately on enable so the user's first match against this
      // source uses fresh data. The 24h staleness check skips the network if
      // the source was previously enabled and refreshed recently.
      if (enabled) {
        setRowState(source.id, { kind: 'fetching' });
        const result = await refreshOne({ ...source, enabled: true });
        setRowState(
          source.id,
          result.ok ? { kind: 'idle' } : { kind: 'error', message: result.error ?? 'Fetch failed' },
        );
        // Pick up new entry count immediately even if onKeyChanged hasn't fired.
        setCachedLists(loadWishlists());
      }
    },
    [sources, persistSources, setRowState],
  );

  const handleRefreshOne = useCallback(
    async (source: WishlistSource) => {
      setRowState(source.id, { kind: 'fetching' });
      const result = await refreshOne(source, { force: true });
      setRowState(
        source.id,
        result.ok ? { kind: 'idle' } : { kind: 'error', message: result.error ?? 'Fetch failed' },
      );
      setCachedLists(loadWishlists());
    },
    [setRowState],
  );

  const handleRefreshAll = useCallback(async () => {
    setRefreshAllPending(true);
    setRefreshAllToast(null);
    const enabled = sources.filter((s) => s.enabled);
    for (const s of enabled) setRowState(s.id, { kind: 'fetching' });
    const results = await refreshWishlists(enabled, { force: true });
    for (const result of results) {
      setRowState(
        result.sourceId,
        result.ok
          ? { kind: 'idle' }
          : { kind: 'error', message: result.error ?? 'Fetch failed' },
      );
    }
    setCachedLists(loadWishlists());
    setRefreshAllPending(false);
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    setRefreshAllToast(
      failCount === 0
        ? `Refreshed ${okCount} source${okCount === 1 ? '' : 's'}.`
        : `Refreshed ${okCount}, ${failCount} failed.`,
    );
    window.setTimeout(() => setRefreshAllToast(null), 4000);
  }, [sources, setRowState]);

  const handleAddCustom = useCallback(async () => {
    setAddError(null);
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) {
      setAddError('Paste a URL first.');
      return;
    }
    if (sources.some((s) => s.url === trimmedUrl)) {
      setAddError('That URL is already in your sources.');
      return;
    }
    setValidating(true);
    const result = await validateWishlistUrl(trimmedUrl);
    setValidating(false);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    const id = `custom-${crypto.randomUUID()}`;
    const trimmedName = newName.trim();
    const derivedName = trimmedName || deriveNameFromUrl(trimmedUrl);
    const newSource: WishlistSource = {
      id,
      name: derivedName,
      url: trimmedUrl,
      enabled: true,
      builtin: false,
    };
    const next = [...sources, newSource];
    persistSources(next);
    setNewUrl('');
    setNewName('');
    // Fetch the just-added source so the Map populates and entry count shows up.
    setRowState(id, { kind: 'fetching' });
    const fetchResult = await refreshOne(newSource, { force: true });
    setRowState(
      id,
      fetchResult.ok
        ? { kind: 'idle' }
        : { kind: 'error', message: fetchResult.error ?? 'Fetch failed' },
    );
    setCachedLists(loadWishlists());
  }, [newUrl, newName, sources, persistSources, setRowState]);

  const handleDeleteCustom = useCallback(
    (source: WishlistSource) => {
      const ok = window.confirm(`Delete "${source.name}"? The cached entries will also be removed.`);
      if (!ok) return;
      const next = sources.filter((s) => s.id !== source.id);
      persistSources(next);
      // Also clear the cached parsed list for this source to avoid stale entries
      // continuing to score after the user removed the source.
      const remainingCache = loadWishlists().filter((l) => l.id !== source.id);
      // Reuse saveWishlists indirectly via the cache module would be cleaner, but
      // a direct write keeps this delete self-contained in the panel. The SW will
      // re-hydrate from this on its next wake.
      void import('@/core/storage/scoring-config').then((mod) => {
        mod.saveWishlists(remainingCache);
        setCachedLists(remainingCache);
      });
    },
    [sources, persistSources],
  );

  const handleRenameCustom = useCallback(
    (source: WishlistSource, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (trimmed === source.name) return;
      const next = sources.map((s) => (s.id === source.id ? { ...s, name: trimmed } : s));
      persistSources(next);
    },
    [sources, persistSources],
  );

  const builtins = sources.filter((s) => s.builtin);
  const customs = sources.filter((s) => !s.builtin);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-2">
        <h2 className="text-base font-semibold">Wishlist Sources</h2>
        <p className="text-sm text-text-muted">
          Cryptarch scores your weapon drops against curated community wishlists. Enable the
          sources you trust. Sources refresh at most once per 24 hours.
        </p>
      </div>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-text-muted px-1">Built-in sources</div>
        <div className="rounded-lg border border-bg-border bg-bg-card divide-y divide-bg-border">
          {builtins.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              cachedList={cacheById.get(source.id)}
              rowState={rowStates.get(source.id) ?? { kind: 'idle' }}
              nowTick={nowTick}
              onToggle={(enabled) => void handleToggle(source, enabled)}
              onRefresh={() => void handleRefreshOne(source)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-text-muted px-1">
          Custom sources
        </div>
        {customs.length > 0 && (
          <div className="rounded-lg border border-bg-border bg-bg-card divide-y divide-bg-border">
            {customs.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                cachedList={cacheById.get(source.id)}
                rowState={rowStates.get(source.id) ?? { kind: 'idle' }}
                nowTick={nowTick}
                onToggle={(enabled) => void handleToggle(source, enabled)}
                onRefresh={() => void handleRefreshOne(source)}
                onDelete={() => handleDeleteCustom(source)}
                onRename={(name) => handleRenameCustom(source, name)}
              />
            ))}
          </div>
        )}

        <div className="rounded-lg border border-bg-border bg-bg-card p-4 space-y-2">
          <div className="text-sm font-medium">Add your own wishlist URL</div>
          <p className="text-xs text-text-muted">
            Paste a raw GitHub URL (one starting with{' '}
            <code className="text-rahool-blue">raw.githubusercontent.com</code>) that contains DIM
            wishlist lines.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="url"
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="https://raw.githubusercontent.com/..."
              disabled={validating}
              className="flex-1 px-3 py-2 text-sm rounded bg-bg-primary border border-bg-border text-text-primary placeholder:text-text-muted disabled:opacity-50"
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional)"
              disabled={validating}
              className="sm:w-48 px-3 py-2 text-sm rounded bg-bg-primary border border-bg-border text-text-primary placeholder:text-text-muted disabled:opacity-50"
            />
            <button
              onClick={() => void handleAddCustom()}
              disabled={validating || newUrl.trim() === ''}
              className="px-4 py-2 text-sm rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {validating ? 'Validating…' : 'Add'}
            </button>
          </div>
          {addError && <div className="text-xs text-red-400">{addError}</div>}
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="text-xs text-text-muted">
          {refreshAllToast ?? 'Refresh forces a fetch of all enabled sources.'}
        </div>
        <button
          onClick={() => void handleRefreshAll()}
          disabled={refreshAllPending}
          className="px-4 py-2 text-sm rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {refreshAllPending ? 'Refreshing…' : 'Refresh all'}
        </button>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  cachedList,
  rowState,
  nowTick,
  onToggle,
  onRefresh,
  onDelete,
  onRename,
}: {
  source: WishlistSource;
  cachedList: ImportedWishList | undefined;
  rowState: RowState;
  nowTick: number;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(source.name);

  useEffect(() => {
    setDraftName(source.name);
  }, [source.name]);

  const lastUpdated = cachedList?.importedAt;
  const entryCount = cachedList?.entryCount;

  const statusLabel = (() => {
    if (rowState.kind === 'fetching') return { text: 'Fetching…', tone: 'muted' as const };
    if (rowState.kind === 'error') return { text: 'Error', tone: 'error' as const };
    if (lastUpdated) return { text: 'Loaded', tone: 'ok' as const };
    if (source.enabled) return { text: 'Never fetched', tone: 'muted' as const };
    return { text: 'Disabled', tone: 'muted' as const };
  })();

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <label className="flex items-center pt-1 cursor-pointer">
        <input
          type="checkbox"
          checked={source.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="w-4 h-4 accent-rahool-blue"
        />
      </label>

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {onRename && editingName ? (
            <input
              autoFocus
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => {
                onRename(draftName);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRename(draftName);
                  setEditingName(false);
                } else if (e.key === 'Escape') {
                  setDraftName(source.name);
                  setEditingName(false);
                }
              }}
              className="text-sm font-medium bg-bg-primary border border-bg-border rounded px-2 py-0.5"
            />
          ) : (
            <button
              type="button"
              onClick={() => onRename && setEditingName(true)}
              disabled={!onRename}
              className={`text-sm font-medium ${
                onRename ? 'hover:text-rahool-blue cursor-text' : 'cursor-default'
              }`}
              title={onRename ? 'Click to rename' : undefined}
            >
              {source.name}
            </button>
          )}
          <StatusChip tone={statusLabel.tone} text={statusLabel.text} />
        </div>

        {source.description && (
          <div className="text-xs text-text-muted">{source.description}</div>
        )}

        <div className="text-xs text-text-muted flex items-center gap-3 flex-wrap">
          {entryCount !== undefined && <span>{entryCount.toLocaleString()} rolls</span>}
          {lastUpdated && (
            <span title={new Date(lastUpdated).toLocaleString()}>
              Updated {formatRelativeTimestamp(nowTick - lastUpdated)}
            </span>
          )}
          {!cachedList && !source.enabled && <span>Enable to fetch.</span>}
        </div>

        {rowState.kind === 'error' && (
          <div className="text-xs text-red-400 break-words">{rowState.message}</div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onRefresh}
          disabled={rowState.kind === 'fetching' || !source.enabled}
          className="text-xs px-2 py-1 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {rowState.kind === 'fetching' ? '…' : 'Refresh'}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded border border-bg-border text-text-muted hover:text-red-400"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function StatusChip({
  tone,
  text,
}: {
  tone: 'ok' | 'muted' | 'error';
  text: string;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-rahool-blue/15 text-rahool-blue border-rahool-blue/40'
      : tone === 'error'
        ? 'bg-red-500/15 text-red-400 border-red-500/40'
        : 'bg-bg-primary text-text-muted border-bg-border';
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {text}
    </span>
  );
}

function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').filter(Boolean);
    const last = path[path.length - 1] ?? u.host;
    // Strip extension and replace separators with spaces.
    return last
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .trim() || u.host;
  } catch {
    return 'Custom wishlist';
  }
}

function formatRelativeTimestamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
