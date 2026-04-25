import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { isLoggedIn } from '@/core/bungie/auth';
import { loadPrimaryMembership } from '@/core/storage/tokens';
import { getItem, onKeyChanged, setItem } from '@/adapters/storage';
import { loadScoringConfig, saveScoringConfig } from '@/core/storage/scoring-config';
import {
  DEFAULT_POPUP_FILTER,
  type DropFeedEntry,
  type PendingNavigation,
  type PopupFilterState,
} from '@/shared/types';
import type { Grade } from '@/core/scoring/types';

const MAX_ROWS = 10;
const POPUP_FILTER_KEY = 'popupFilterState';
const PENDING_NAV_KEY = 'pendingNavigation';

export function Popup() {
  const [signedIn, setSignedIn] = useState<boolean>(() => isLoggedIn());
  const [displayName, setDisplayName] = useState<string | null>(
    () => loadPrimaryMembership()?.displayName ?? null,
  );
  const [feed, setFeed] = useState<DropFeedEntry[]>(() => loadFeed());
  const [filter, setFilter] = useState<PopupFilterState>(
    () => getItem<PopupFilterState>(POPUP_FILTER_KEY) ?? DEFAULT_POPUP_FILTER,
  );
  const [autoLock, setAutoLock] = useState<boolean>(
    () => loadScoringConfig().autoLockOnArmorMatch,
  );
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const unsubFeed = onKeyChanged<DropFeedEntry[]>('drop-feed', (v) => setFeed(v ?? []));
    const unsubTokens = onKeyChanged('auth.tokens', (v) => setSignedIn(!!v));
    const unsubMembership = onKeyChanged<{ displayName: string } | null>(
      'auth.primaryMembership',
      (v) => setDisplayName(v?.displayName ?? null),
    );
    const unsubFilter = onKeyChanged<PopupFilterState>(POPUP_FILTER_KEY, (v) => {
      if (v) setFilter(v);
    });
    // scoring-config changes — options page may flip the autolock toggle too
    const unsubScoring = onKeyChanged('scoring-config', () => {
      setAutoLock(loadScoringConfig().autoLockOnArmorMatch);
    });
    const tickId = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => {
      unsubFeed();
      unsubTokens();
      unsubMembership();
      unsubFilter();
      unsubScoring();
      window.clearInterval(tickId);
    };
  }, []);

  const persistFilter = useCallback((next: PopupFilterState) => {
    setFilter(next);
    setItem(POPUP_FILTER_KEY, next);
  }, []);

  const toggleGrade = useCallback(
    (label: string) => {
      // S is always on — the button for it is disabled, but defensively skip.
      if (label === 'S') return;
      const next = filter.grade.includes(label)
        ? filter.grade.filter((g) => g !== label)
        : [...filter.grade, label];
      persistFilter({ ...filter, grade: next });
    },
    [filter, persistFilter],
  );

  const toggleType = useCallback(
    (label: string) => {
      const next = filter.type.includes(label)
        ? filter.type.filter((t) => t !== label)
        : [...filter.type, label];
      persistFilter({ ...filter, type: next });
    },
    [filter, persistFilter],
  );

  const handleAutoLockToggle = useCallback(() => {
    const next = !autoLock;
    setAutoLock(next);
    const cfg = loadScoringConfig();
    saveScoringConfig({ ...cfg, autoLockOnArmorMatch: next });
  }, [autoLock]);

  const openDashboard = useCallback((instanceId?: string) => {
    if (instanceId) {
      const nav: PendingNavigation = { tab: 'drops', instanceId };
      setItem(PENDING_NAV_KEY, nav);
    }
    chrome.runtime.openOptionsPage();
    window.close();
  }, []);

  const visible = useMemo(() => {
    return feed
      .filter((e) => {
        const typeLabel = e.itemType === 'weapon' ? 'Weapons' : 'Armor';
        if (!filter.type.includes(typeLabel)) return false;
        if (e.isExotic) return filter.grade.includes('Exotic');
        if (e.grade === 'S' || e.grade === 'A' || e.grade === 'B') {
          return filter.grade.includes(e.grade);
        }
        // C/D/F and ungraded items don't show in popup.
        return false;
      })
      .slice(0, MAX_ROWS);
  }, [feed, filter]);

  return (
    <div className="flex flex-col">
      <Header
        signedIn={signedIn}
        displayName={displayName}
        onSignIn={() => openDashboard()}
      />

      {signedIn && (
        <>
          <FilterChipRow filter={filter} onToggleGrade={toggleGrade} onToggleType={toggleType} />

          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 340 }}>
            {feed.length === 0 ? (
              <EmptyState>No drops yet. Play Destiny 2 to see drops appear here.</EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState>No drops match filters.</EmptyState>
            ) : (
              <ul className="divide-y divide-bg-border">
                {visible.map((e) => (
                  <DropRow
                    key={e.instanceId}
                    entry={e}
                    nowTick={nowTick}
                    onClick={() => openDashboard(e.instanceId)}
                  />
                ))}
              </ul>
            )}
          </div>

          <AutoLockRow on={autoLock} onToggle={handleAutoLockToggle} />
        </>
      )}

      <div className="border-t border-bg-border px-3 py-2 space-y-1.5">
        <button
          onClick={() => openDashboard()}
          className="w-full text-sm px-3 py-2 rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30"
        >
          Open Dashboard
        </button>
        <a
          href="https://ko-fi.com/frailrain"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-[10px] text-text-muted hover:text-rahool-blue"
        >
          Buy me a coffee ☕
        </a>
      </div>
    </div>
  );
}

function Header({
  signedIn,
  displayName,
  onSignIn,
}: {
  signedIn: boolean;
  displayName: string | null;
  onSignIn: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-bg-border px-3 py-2">
      <div className="flex items-center gap-2">
        <img
          src={chrome.runtime.getURL('icons/icon48.png')}
          alt=""
          className="w-6 h-6 rounded"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold">Cryptarch</span>
      </div>
      {signedIn ? (
        <div className="flex items-center gap-1.5 text-xs text-text-muted" title="Signed in">
          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="truncate max-w-[140px]">{displayName ?? 'Signed in'}</span>
        </div>
      ) : (
        <button
          onClick={onSignIn}
          className="text-xs px-2 py-1 rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30"
        >
          Sign in
        </button>
      )}
    </div>
  );
}

function FilterChipRow({
  filter,
  onToggleGrade,
  onToggleType,
}: {
  filter: PopupFilterState;
  onToggleGrade: (label: string) => void;
  onToggleType: (label: string) => void;
}) {
  return (
    <div className="flex items-center flex-wrap gap-1 border-b border-bg-border px-3 py-2">
      {/* Grade group */}
      <button
        disabled
        title="S grade always shown"
        className="px-2 py-0.5 rounded text-xs bg-grade-s/20 text-grade-s border border-grade-s/50 cursor-not-allowed"
      >
        S
      </button>
      <ChipToggle
        label="A"
        active={filter.grade.includes('A')}
        onToggle={() => onToggleGrade('A')}
        activeCls="bg-grade-a/20 text-grade-a border-grade-a/50"
      />
      <ChipToggle
        label="B"
        active={filter.grade.includes('B')}
        onToggle={() => onToggleGrade('B')}
        activeCls="bg-grade-b/20 text-grade-b border-grade-b/50"
      />
      <ChipToggle
        label="Exotic"
        active={filter.grade.includes('Exotic')}
        onToggle={() => onToggleGrade('Exotic')}
        activeCls="bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50"
      />
      <span className="mx-1 text-text-muted/40" aria-hidden="true">
        |
      </span>
      {/* Type group */}
      <ChipToggle
        label="Weapons"
        active={filter.type.includes('Weapons')}
        onToggle={() => onToggleType('Weapons')}
        activeCls="bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40"
      />
      <ChipToggle
        label="Armor"
        active={filter.type.includes('Armor')}
        onToggle={() => onToggleType('Armor')}
        activeCls="bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40"
      />
    </div>
  );
}

function ChipToggle({
  label,
  active,
  onToggle,
  activeCls,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeCls: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`px-2 py-0.5 rounded text-xs border ${
        active ? activeCls : 'bg-bg-primary text-text-muted border-bg-border'
      }`}
    >
      {label}
    </button>
  );
}

function DropRow({
  entry,
  nowTick,
  onClick,
}: {
  entry: DropFeedEntry;
  nowTick: number;
  onClick: () => void;
}) {
  const deleted = entry.deleted === true;
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-border/40 text-left ${
          deleted ? 'opacity-60' : ''
        }`}
      >
        <Chip entry={entry} />
        <span
          className={`flex-1 min-w-0 text-xs truncate ${
            entry.isExotic ? 'text-grade-exotic' : 'text-text-primary'
          } ${deleted ? 'line-through' : ''}`}
        >
          {entry.itemName}
          {!deleted && entry.itemType === 'armor' && entry.armorMatched === true && (
            <span className="text-emerald-400 ml-1" aria-label="matched">
              ✓
            </span>
          )}
          {!deleted && entry.locked && (
            <span className="ml-1" aria-label="locked">
              🔒
            </span>
          )}
        </span>
        {!deleted && <WishlistTag matches={entry.wishlistMatches} />}
        <span className="text-[10px] text-text-muted whitespace-nowrap">
          {deleted ? 'Dismantled' : formatRelative(nowTick - entry.timestamp)}
        </span>
      </button>
    </li>
  );
}

function WishlistTag({ matches }: { matches: DropFeedEntry['wishlistMatches'] }) {
  if (!matches || matches.length === 0) return null;
  // Single match: abbreviate to first word of source name (e.g. "Aegis" instead
  // of "Aegis Endgame Analysis") so the popup row doesn't break on long names.
  // Full name + notes available on hover.
  // Multiple matches: numeric badge so we don't have to fit several names in.
  const isMulti = matches.length > 1;
  const label = isMulti ? `Wishlist ×${matches.length}` : matches[0].sourceName.split(' ')[0];
  const title = isMulti
    ? matches.map((m) => m.sourceName).join(', ')
    : matches[0].notes
      ? `${matches[0].sourceName} — ${matches[0].notes}`
      : matches[0].sourceName;
  return (
    <span
      title={title}
      className="text-[10px] px-1.5 py-0.5 rounded border bg-rahool-blue/15 text-rahool-blue border-rahool-blue/40 whitespace-nowrap"
    >
      {label}
    </span>
  );
}

function Chip({ entry }: { entry: DropFeedEntry }) {
  if (entry.isExotic) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-semibold border bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50">
        Ex
      </span>
    );
  }
  if (entry.itemType === 'weapon' && entry.grade) {
    return <GradeChip grade={entry.grade} />;
  }
  // Armor: use letter grade if present, otherwise blank slot.
  if (entry.grade) return <GradeChip grade={entry.grade} />;
  return <span className="inline-flex w-5 h-5" aria-hidden="true" />;
}

function GradeChip({ grade }: { grade: Grade }) {
  const cls =
    grade === 'S'
      ? 'bg-grade-s/20 text-grade-s border-grade-s/50'
      : grade === 'A'
        ? 'bg-grade-a/20 text-grade-a border-grade-a/50'
        : grade === 'B'
          ? 'bg-grade-b/20 text-grade-b border-grade-b/50'
          : 'bg-bg-border text-text-muted border-bg-border';
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold border ${cls}`}
    >
      {grade}
    </span>
  );
}

function AutoLockRow({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-bg-border px-3 py-2">
      <span className="text-xs text-text-primary">Auto-lock matches</span>
      <button
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          on ? 'bg-rahool-blue' : 'bg-bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-muted text-center py-6 px-3">{children}</div>;
}

function formatRelative(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
