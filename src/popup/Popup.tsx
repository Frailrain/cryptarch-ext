import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { isLoggedIn } from '@/core/bungie/auth';
import { loadAuthState, loadPrimaryMembership, type AuthState } from '@/core/storage/tokens';
import { getItem, onKeyChanged, setItem } from '@/adapters/storage';
import { loadScoringConfig, saveScoringConfig } from '@/core/storage/scoring-config';
import { send } from '@/shared/messaging';
import { RolledPerkRow } from '@/settings/components/RolledPerkRow';
import { requestPerkPool } from '@/adapters/perk-pool-messages';
import {
  DEFAULT_POPUP_FILTER,
  type DropFeedEntry,
  type PendingNavigation,
  type PopupFilterState,
  type TierLetter,
} from '@/shared/types';

const TIER_FILTER_ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];

// Brief #12 migration: pre-#12 PopupFilterState had `grade: string[]` mixing
// S/A/B and 'Exotic' in one array. Replaced with separate tiers + showExotic.
// Old stored values map to: tiers default all-on (no clean grade→tier mapping),
// showExotic = whether 'Exotic' was in the old grade array.
function loadPopupFilter(): PopupFilterState {
  const raw = getItem<{
    grade?: string[];
    type?: string[];
    tiers?: TierLetter[];
    showExotic?: boolean;
  }>(POPUP_FILTER_KEY);
  if (!raw) return DEFAULT_POPUP_FILTER;
  // Modern shape (post-#12): tiers and showExotic both present.
  if (Array.isArray(raw.tiers) && typeof raw.showExotic === 'boolean') {
    return {
      type: raw.type ?? DEFAULT_POPUP_FILTER.type,
      tiers: raw.tiers,
      showExotic: raw.showExotic,
    };
  }
  // Legacy shape: derive what we can.
  return {
    type: raw.type ?? DEFAULT_POPUP_FILTER.type,
    tiers: DEFAULT_POPUP_FILTER.tiers,
    showExotic: Array.isArray(raw.grade) ? raw.grade.includes('Exotic') : true,
  };
}

const MAX_ROWS = 10;
const POPUP_FILTER_KEY = 'popupFilterState';
const PENDING_NAV_KEY = 'pendingNavigation';

export function Popup() {
  const [signedIn, setSignedIn] = useState<boolean>(() => isLoggedIn());
  const [authState, setAuthState] = useState<AuthState>(() => loadAuthState());
  const [reconnectPending, setReconnectPending] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(
    () => loadPrimaryMembership()?.displayName ?? null,
  );
  const [feed, setFeed] = useState<DropFeedEntry[]>(() => loadFeed());
  const [filter, setFilter] = useState<PopupFilterState>(() => loadPopupFilter());
  const [autoLock, setAutoLock] = useState<boolean>(
    () => loadScoringConfig().autoLockOnArmorMatch,
  );
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const unsubFeed = onKeyChanged<DropFeedEntry[]>('drop-feed', (v) => setFeed(v ?? []));
    const unsubTokens = onKeyChanged('auth.tokens', (v) => setSignedIn(!!v));
    const unsubAuthState = onKeyChanged<AuthState>('auth.state', (v) => {
      setAuthState(v ?? 'signed-out');
    });
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
      unsubAuthState();
      unsubMembership();
      unsubFilter();
      unsubScoring();
      window.clearInterval(tickId);
    };
  }, []);

  // Mirror DropLogPanel's idle prewarm: fire-and-forget perk-pool fetches for
  // the latest 10 unique weapon hashes in the feed. The SW serves cached
  // results instantly; misses populate the cache for next time. Side-effect
  // populates the page-side perk name cache (see perk-pool-messages.ts) so
  // popup row tooltips show real perk names instead of hash fallbacks.
  useEffect(() => {
    const seen = new Set<number>();
    for (const e of feed) {
      if (e.itemType !== 'weapon') continue;
      if (e.itemHash === undefined) continue;
      if (seen.has(e.itemHash)) continue;
      seen.add(e.itemHash);
      if (seen.size >= 10) break;
    }
    for (const hash of seen) {
      void requestPerkPool(hash);
    }
  }, [feed]);

  const persistFilter = useCallback((next: PopupFilterState) => {
    setFilter(next);
    setItem(POPUP_FILTER_KEY, next);
  }, []);

  const toggleTier = useCallback(
    (tier: TierLetter) => {
      const next = filter.tiers.includes(tier)
        ? filter.tiers.filter((t) => t !== tier)
        : [...filter.tiers, tier];
      persistFilter({ ...filter, tiers: next });
    },
    [filter, persistFilter],
  );

  const toggleExotic = useCallback(() => {
    persistFilter({ ...filter, showExotic: !filter.showExotic });
  }, [filter, persistFilter]);

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

  // Brief #22: one-click reconnect from the popup banner. Triggers the same
  // auth-start message the dashboard's sign-in button uses; SW handles the
  // OAuth flow. On success auth.state flips back to 'signed-in' and the
  // banner disappears via the onKeyChanged subscription above.
  const handleReconnect = useCallback(async () => {
    setReconnectPending(true);
    await send({ type: 'auth-start' });
    setReconnectPending(false);
  }, []);

  const visible = useMemo(() => {
    return feed
      .filter((e) => {
        const typeLabel = e.itemType === 'weapon' ? 'Weapons' : 'Armor';
        if (!filter.type.includes(typeLabel)) return false;
        if (e.isExotic) return filter.showExotic;
        // Brief #12: tier filter applies to weapons with tier metadata. Drops
        // without a weaponTier (Voltron-only matches without Aegis quote, pre-#12
        // entries) always pass the tier gate. Armor passes through to the
        // armorMatched check below.
        if (e.itemType === 'weapon') {
          if (e.weaponTier && !filter.tiers.includes(e.weaponTier)) return false;
          return true;
        }
        // Armor without explicit match status: show. Otherwise show if matched.
        return e.armorMatched !== false;
      })
      .slice(0, MAX_ROWS);
  }, [feed, filter]);

  const showExpiredBanner = authState === 'expired';

  return (
    <div className="flex flex-col">
      {showExpiredBanner && (
        <ExpiredBanner pending={reconnectPending} onReconnect={handleReconnect} />
      )}
      <Header
        signedIn={signedIn}
        displayName={displayName}
        onSignIn={() => openDashboard()}
      />

      {signedIn && (
        <>
          <FilterChipRow
            filter={filter}
            onToggleTier={toggleTier}
            onToggleExotic={toggleExotic}
            onToggleType={toggleType}
          />

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

function ExpiredBanner({
  pending,
  onReconnect,
}: {
  pending: boolean;
  onReconnect: () => void;
}) {
  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-2">
      <span className="text-xs text-amber-300">Bungie connection expired</span>
      <button
        onClick={onReconnect}
        disabled={pending}
        className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Waiting…' : 'Reconnect →'}
      </button>
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
  onToggleTier,
  onToggleExotic,
  onToggleType,
}: {
  filter: PopupFilterState;
  onToggleTier: (tier: TierLetter) => void;
  onToggleExotic: () => void;
  onToggleType: (label: string) => void;
}) {
  return (
    <div className="flex items-center flex-wrap gap-1 border-b border-bg-border px-3 py-2">
      {/* Tier group (replaces pre-#12 grade chips) */}
      {TIER_FILTER_ORDER.map((tier) => (
        <TierFilterChip
          key={tier}
          tier={tier}
          active={filter.tiers.includes(tier)}
          onToggle={() => onToggleTier(tier)}
        />
      ))}
      <ChipToggle
        label="Exotic"
        active={filter.showExotic}
        onToggle={onToggleExotic}
        activeCls="bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50"
      />
      <span className="mx-1 text-text-muted/40" aria-hidden="true">
        |
      </span>
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

const TIER_CHIP_COLORS: Record<TierLetter, string> = {
  S: 'bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50',
  A: 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/50',
  B: 'bg-rahool-blue/10 text-rahool-blue/70 border-rahool-blue/30',
  C: 'bg-text-muted/15 text-text-muted border-text-muted/30',
  D: 'bg-text-muted/10 text-text-muted/60 border-text-muted/20',
  F: 'bg-red-500/15 text-red-400/80 border-red-500/30',
};

function TierFilterChip({
  tier,
  active,
  onToggle,
}: {
  tier: TierLetter;
  active: boolean;
  onToggle: () => void;
}) {
  const cls = active ? TIER_CHIP_COLORS[tier] : 'bg-bg-primary text-text-muted border-bg-border';
  return (
    <button
      onClick={onToggle}
      title={`Tier ${tier}`}
      className={`px-2 py-0.5 rounded text-xs border ${cls}`}
    >
      {tier}
    </button>
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
        {/* Brief #21 follow-up: dropped the WishlistTag chip — the gold
            border on the rolled-perk icons + the tier chip + thumbs-up
            indicator already convey the wishlist signal. The chip was
            redundant and crowded the popup row. */}
        {!deleted && <RolledPerkRow entry={entry} iconSize={22} />}
        <span className="text-[10px] text-text-muted whitespace-nowrap">
          {deleted ? 'Dismantled' : formatRelative(nowTick - entry.timestamp)}
        </span>
      </button>
    </li>
  );
}

function Chip({ entry }: { entry: DropFeedEntry }) {
  // Brief #12 follow-up: grade chip removed in favor of tier chip; popup
  // mirrors the Drop Log treatment (one chip per row, tier-colored, blank
  // when the drop has no tier metadata).
  if (entry.isExotic) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-semibold border bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50">
        Ex
      </span>
    );
  }
  if (entry.weaponTier) {
    const cls = TIER_CHIP_COLORS[entry.weaponTier];
    return (
      <span
        title={`Tier ${entry.weaponTier}`}
        className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold border ${cls}`}
      >
        {entry.weaponTier}
      </span>
    );
  }
  return <span className="inline-flex w-5 h-5" aria-hidden="true" />;
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
