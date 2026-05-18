// Brief #23 Phase D — Destiny-native custom-source list. Renders inside the
// Settings tab's Wishlist Coverage Panel; this file has no outer panel
// chrome of its own (the parent provides it).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WishlistMetadata, WishlistSource } from '@/shared/types';
import {
  loadWishlistMetadata,
  loadWishlistSources,
  saveWishlistSources,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
// Brief #12.5 Part D: settings is a viewer. All wishlist mutations go through
// SW message handlers via this client wrapper.
import {
  requestDropSource,
  requestRefreshOne,
  requestValidateUrl,
} from '@/adapters/wishlist-messages';
import { Btn, Chip, SectionHead } from '@/components/destiny';

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
        <header className="space-y-1">
          <SectionHead>Custom GitHub Repositories</SectionHead>
          <p className="text-d-11 text-d-text-muted leading-relaxed">
            Custom sources fire notifications when rolls match but won&apos;t appear
            as tier chips or gold-border perks in the Drop Log. Use these for
            clan-specific or experimental wishlists.
          </p>
        </header>
      )}

      <div className="border border-d-hairline p-3 space-y-2">
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
            className="flex-1 px-3 py-2 text-d-12 bg-d-bg-pressed border border-d-hairline text-d-text placeholder:text-d-text-muted focus:outline-none focus:border-d-gold-line transition-colors duration-d-fast disabled:opacity-50"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (optional)"
            disabled={validating}
            className="sm:w-48 px-3 py-2 text-d-12 bg-d-bg-pressed border border-d-hairline text-d-text placeholder:text-d-text-muted focus:outline-none focus:border-d-gold-line transition-colors duration-d-fast disabled:opacity-50"
          />
          <Btn
            variant="primary"
            onClick={() => void handleAddCustom()}
            disabled={validating || newUrl.trim() === ''}
          >
            {validating ? 'Validating…' : 'Add'}
          </Btn>
        </div>
        {addError && <div className="text-d-10 text-d-shard uppercase tracking-d-wide">{addError}</div>}
      </div>

      {customs.length > 0 ? (
        <ul className="border-y border-d-hairline divide-y divide-d-hairline">
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
        </ul>
      ) : (
        <div className="text-d-11 text-d-text-muted text-center py-6">
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

  const statusKind = (() => {
    if (rowState.kind === 'fetching') return 'fetching' as const;
    if (rowState.kind === 'error') return 'error' as const;
    if (lastUpdated) return 'ok' as const;
    return 'idle' as const;
  })();

  return (
    <li className="px-3 py-3 flex items-start gap-3 hover:bg-d-bg-hover transition-colors duration-d-fast">
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
              className="text-d-13 font-medium bg-d-bg-pressed border border-d-hairline px-2 py-0.5 focus:outline-none focus:border-d-gold-line"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="text-d-13 font-medium text-d-text hover:text-d-gold-pale transition-colors duration-d-fast cursor-text"
              title="Click to rename"
            >
              {source.name}
            </button>
          )}
          <StatusBadge kind={statusKind} />
        </div>

        <div className="text-d-10 text-d-text-muted uppercase tracking-d-wide flex items-center gap-3 flex-wrap">
          {entryCount !== undefined && <span>{entryCount.toLocaleString()} rolls</span>}
          {lastUpdated && (
            <span title={new Date(lastUpdated).toLocaleString()}>
              Updated {formatRelativeTimestamp(nowTick - lastUpdated)}
            </span>
          )}
        </div>

        {rowState.kind === 'error' && (
          <div className="text-d-10 text-d-shard break-words">{rowState.message}</div>
        )}
      </div>

      <Btn variant="danger" small onClick={onDelete}>
        Remove
      </Btn>
    </li>
  );
}

function StatusBadge({ kind }: { kind: 'ok' | 'idle' | 'fetching' | 'error' }) {
  const config = (() => {
    switch (kind) {
      case 'ok':
        return { color: 'keep' as const, label: 'Loaded' };
      case 'fetching':
        return { color: 'gold' as const, label: 'Fetching…' };
      case 'error':
        return { color: 'shard' as const, label: 'Error' };
      case 'idle':
      default:
        return { color: 'neutral' as const, label: 'Never fetched' };
    }
  })();
  return (
    <Chip active color={config.color}>
      {config.label}
    </Chip>
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
