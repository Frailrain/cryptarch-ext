import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WishlistMetadata, WishlistSource } from '@/shared/types';
import {
  loadWishlistMetadata,
  loadWishlistSources,
  saveWishlistSources,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
// Brief #12.5 Part D: settings is a viewer. All wishlist mutations go through
// SW message handlers via this client wrapper. Direct imports of the
// fetch/cache/matcher modules from settings are forbidden — see comment block
// at the top of cache.ts for why.
import {
  requestDropSource,
  requestRefreshOne,
  requestValidateUrl,
} from '@/adapters/wishlist-messages';

// Per-source UI state machine. The persisted FetchStatus in cache.ts only lives
// in the service worker context; the settings page tracks its own ephemeral
// status here, scoped to refreshes the user initiates from this tab.
type RowState =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'error'; message: string };

export function WishlistsPanel({ showHeader = true }: { showHeader?: boolean } = {}) {
  const [sources, setSources] = useState<WishlistSource[]>(() => loadWishlistSources());
  // Brief #12.5 Part D: lightweight metadata view (~5 KB, sync read from
  // adapter cache). Returns [] when missing — the SW derives + persists
  // metadata on its own hydrate, so the empty state is transient on a
  // fresh install before the first SW boot completes.
  const [cachedLists, setCachedLists] = useState<WishlistMetadata[]>(() =>
    loadWishlistMetadata(),
  );
  const [rowStates, setRowStates] = useState<Map<string, RowState>>(new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Custom URL form state.
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [validating, setValidating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Cross-context sync: SW background refresh writes both the wishlists key
  // and the lightweight wishlistMetadata key. Subscribing to metadata here
  // lets the UI update without ever pulling the 60 MB+ entries payload into
  // the settings page context.
  useEffect(() => {
    const unsub1 = onKeyChanged<WishlistMetadata[]>('wishlistMetadata', (v) => {
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

  // No auto-refresh on mount, and no manual Refresh buttons either. The SW
  // owns refresh: on each wake it hydrates the cache and kicks a
  // staleness-checked refresh in the background, so any source older than 24h
  // gets re-fetched without page involvement. Earlier versions had a
  // mount-time refreshWishlists call here (and Refresh All / per-row Refresh
  // buttons below); both were removed because the 60 MB write back to
  // chrome.storage.local fans out via onChanged to every page that has a
  // listener registered, which froze the dashboard for 10–30s on every open.

  const cacheById = useMemo(() => {
    const m = new Map<string, WishlistMetadata>();
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
      // Fetch immediately on enable via the SW. The SW's 24h staleness check
      // skips the network if the source was previously enabled and refreshed
      // recently. Settings page just shows fetching → idle/error from the
      // message response.
      if (enabled) {
        setRowState(source.id, { kind: 'fetching' });
        const result = await requestRefreshOne(source.id, false);
        setRowState(
          source.id,
          result.ok
            ? { kind: 'idle' }
            : { kind: 'error', message: result.error },
        );
      }
    },
    [sources, persistSources, setRowState],
  );

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
    const result = await requestValidateUrl(trimmedUrl);
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
    // Trigger the SW to actually fetch + cache the new source. The metadata
    // listener picks up the new entry count once it lands.
    setRowState(id, { kind: 'fetching' });
    const fetchResp = await requestRefreshOne(id, true);
    setRowState(
      id,
      fetchResp.ok ? { kind: 'idle' } : { kind: 'error', message: fetchResp.error },
    );
  }, [newUrl, newName, sources, persistSources, setRowState]);

  const handleDeleteCustom = useCallback(
    async (source: WishlistSource) => {
      const ok = window.confirm(
        `Delete "${source.name}"? The cached entries will also be removed.`,
      );
      if (!ok) return;
      const next = sources.filter((s) => s.id !== source.id);
      persistSources(next);
      // Tell the SW to drop the cached entries for this source. The SW
      // re-persists wishlists + metadata after the drop; the metadata
      // listener here picks up the change and the row disappears.
      void requestDropSource(source.id);
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
      {showHeader && (
        <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-2">
          <h2 className="text-base font-semibold">Wishlist Sources</h2>
          <p className="text-sm text-text-muted">
            Cryptarch scores your weapon drops against curated community wishlists. Enable the
            sources you trust. Sources refresh at most once per 24 hours.
          </p>
        </div>
      )}

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

    </div>
  );
}

function SourceRow({
  source,
  cachedList,
  rowState,
  nowTick,
  onToggle,
  onDelete,
  onRename,
}: {
  source: WishlistSource;
  cachedList: WishlistMetadata | undefined;
  rowState: RowState;
  nowTick: number;
  onToggle: (enabled: boolean) => void;
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

      {onDelete && (
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded border border-bg-border text-text-muted hover:text-red-400"
          >
            Delete
          </button>
        </div>
      )}
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
