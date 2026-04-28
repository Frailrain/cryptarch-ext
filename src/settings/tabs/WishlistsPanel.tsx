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

// Brief #21: this panel is now custom-URLs-only. Built-in source toggles
// (Charles / Voltron / deprecated Aegis) were removed — their state is
// fixed by the new model in known-sources.ts, and the Weapons tab's
// voltronConfirmation toggle controls whether Voltron contributes to
// scoring. Custom GitHub URLs added here default to notification-only:
// they fire alerts but don't appear in tier chips or gold borders.

type RowState =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'error'; message: string };

export function WishlistsPanel({ showHeader = true }: { showHeader?: boolean } = {}) {
  const [sources, setSources] = useState<WishlistSource[]>(() => loadWishlistSources());
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

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
    // Brief #21: custom URLs default to notification-only. They fire alerts
    // when matched but don't decorate the Drop Log row.
    const newSource: WishlistSource = {
      id,
      name: derivedName,
      url: trimmedUrl,
      enabled: true,
      builtin: false,
      notificationOnly: true,
    };
    const next = [...sources, newSource];
    persistSources(next);
    setNewUrl('');
    setNewName('');
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
        `Remove "${source.name}"? The cached entries will also be removed.`,
      );
      if (!ok) return;
      const next = sources.filter((s) => s.id !== source.id);
      persistSources(next);
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

  const customs = sources.filter((s) => !s.builtin);

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="px-1 space-y-0.5">
          <h3 className="text-sm font-medium text-text-primary">
            Custom GitHub repositories
          </h3>
          <p className="text-xs text-text-muted">
            Custom sources fire notifications when rolls match but won&apos;t
            appear as tier chips or gold-border perks in the Drop Log. Use
            these for clan-specific or experimental wishlists.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-bg-border bg-bg-card p-4 space-y-3">
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

      {customs.length > 0 ? (
        <div className="rounded-lg border border-bg-border bg-bg-card divide-y divide-bg-border">
          {customs.map((source) => (
            <CustomSourceRow
              key={source.id}
              source={source}
              cachedList={cacheById.get(source.id)}
              rowState={rowStates.get(source.id) ?? { kind: 'idle' }}
              nowTick={nowTick}
              onDelete={() => handleDeleteCustom(source)}
              onRename={(name) => handleRenameCustom(source, name)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-bg-border bg-bg-card p-4 text-sm text-text-muted text-center">
          No custom sources added.
        </div>
      )}
    </div>
  );
}

function CustomSourceRow({
  source,
  cachedList,
  rowState,
  nowTick,
  onDelete,
  onRename,
}: {
  source: WishlistSource;
  cachedList: WishlistMetadata | undefined;
  rowState: RowState;
  nowTick: number;
  onDelete: () => void;
  onRename: (name: string) => void;
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
    return { text: 'Never fetched', tone: 'muted' as const };
  })();

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {editingName ? (
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
              onClick={() => setEditingName(true)}
              className="text-sm font-medium hover:text-rahool-blue cursor-text"
              title="Click to rename"
            >
              {source.name}
            </button>
          )}
          <StatusChip tone={statusLabel.tone} text={statusLabel.text} />
        </div>

        <div className="text-xs text-text-muted flex items-center gap-3 flex-wrap">
          {entryCount !== undefined && <span>{entryCount.toLocaleString()} rolls</span>}
          {lastUpdated && (
            <span title={new Date(lastUpdated).toLocaleString()}>
              Updated {formatRelativeTimestamp(nowTick - lastUpdated)}
            </span>
          )}
        </div>

        {rowState.kind === 'error' && (
          <div className="text-xs text-red-400 break-words">{rowState.message}</div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded border border-bg-border text-text-muted hover:text-red-400"
        >
          Remove
        </button>
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
