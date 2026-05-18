// Brief #23 — Destiny-native dashboard rewrite.
//
// Shell: new top bar, new tab nav (Drops / Armor / Settings), sacred-geometry
// background drift, new banners.
//
// Tab bodies: Drops gets a full rewrite using new atoms wrapping DropLogPanel.
// Armor + Settings keep their existing panel internals (RulesPanel,
// WeaponsPanel) wrapped in the new Panel chrome. Settings adds a new Bungie
// Account sub-panel. Sub-panel internals (DropLogPanel, RulesPanel,
// WeaponsPanel) are still legacy-Tailwind for now — they get rewritten in
// the next pass; v0.7 ships the chrome reskin first.

import { useCallback, useEffect, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { isLoggedIn } from '@/core/bungie/auth';
import {
  loadActiveCharacter,
  loadAuthState,
  loadPrimaryMembership,
  type ActiveCharacter,
  type AuthState,
} from '@/core/storage/tokens';
import { getItem, onKeyChanged, removeItem, setItem } from '@/adapters/storage';
import { send } from '@/shared/messaging';
import pkg from '../../package.json';
import type { DropFeedEntry } from '@/shared/types';
import { DropLogPanel, type DropTypeFilter, type DropMatchFilter } from './tabs/DropLogPanel';
import { RulesPanel } from './tabs/RulesPanel';
import { WeaponsPanel } from './tabs/WeaponsPanel';
import { WishlistTestPanel } from './components/WishlistTestPanel';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';
import { ManifestLoadingCard } from './components/ManifestLoadingCard';
import { AutolockFailedBanner } from './components/AutolockFailedBanner';
import type { ManifestProgress } from '@/core/bungie/manifest';
import type {
  ArmorTaxonomyPayload,
  AutolockFailedPayload,
  PendingNavigation,
  TierLetter,
} from '@/shared/types';
import { loadScoringConfig, saveScoringConfig } from '@/core/storage/scoring-config';
import {
  BracketBtn,
  Btn,
  Divider,
  Headline,
  Panel,
  SacredBg,
} from '@/components/destiny';

// Tab labels per Brief #23 redesign: 'weapons' renamed to 'settings'. Internal
// tab-body components keep their existing filenames (WeaponsPanel still
// manages the wishlist-coverage UI even though the tab is labeled Settings).
type Tab = 'drops' | 'armor' | 'settings';

// Forward-migrate pre-#23 pendingNavigation values: 'rules' → 'armor',
// 'wishlists' / 'weapons' → 'settings'. Anything else falls back to null.
function loadAndMigratePendingNavigation(): PendingNavigation | null {
  const raw = getItem<{ tab: string; instanceId?: string }>('pendingNavigation');
  if (!raw) return null;
  let migrated: string = raw.tab;
  if (migrated === 'rules') migrated = 'armor';
  if (migrated === 'wishlists' || migrated === 'weapons') migrated = 'settings';
  if (migrated !== 'drops' && migrated !== 'armor' && migrated !== 'settings') {
    return null;
  }
  return { tab: migrated as Tab, instanceId: raw.instanceId };
}

export function Settings(): JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean>(() => isLoggedIn());
  const [displayName, setDisplayName] = useState<string | null>(
    () => loadPrimaryMembership()?.displayName ?? null,
  );
  const [activeCharacter, setActiveCharacter] = useState<ActiveCharacter | null>(
    () => loadActiveCharacter(),
  );
  const [feed, setFeed] = useState<DropFeedEntry[]>(() => loadFeed());
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [typeFilter, setTypeFilter] = useState<DropTypeFilter>('all');
  const [matchFilter, setMatchFilter] = useState<DropMatchFilter>('all');
  const [showExotic, setShowExotic] = useState(true);
  const [visibleTiers, setVisibleTiers] = useState<Set<TierLetter>>(
    () => new Set<TierLetter>(['S', 'A', 'B', 'C', 'D', 'F']),
  );
  const [authState, setAuthState] = useState<AuthState>(() => loadAuthState());
  const [expiredBannerDismissed, setExpiredBannerDismissed] = useState(false);
  const [manifestReady, setManifestReady] = useState<boolean>(
    () => getItem<boolean>('manifest.ready') === true,
  );
  const [manifestProgress, setManifestProgress] = useState<ManifestProgress | null>(
    () => getItem<ManifestProgress>('manifest.progress'),
  );
  const [autolockFailed, setAutolockFailed] = useState<AutolockFailedPayload | null>(
    () => getItem<AutolockFailedPayload>('autolock.failed.last'),
  );
  const [autolockFailedDismissedAt, setAutolockFailedDismissedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('drops');
  const [taxonomy, setTaxonomy] = useState<ArmorTaxonomyPayload | null>(null);
  const [autoLockOnArmorMatch, setAutoLockOnArmorMatch] = useState<boolean>(
    () => loadScoringConfig().autoLockOnArmorMatch,
  );
  const [highlightInstanceId, setHighlightInstanceId] = useState<string | null>(null);

  useEffect(() => {
    const unsubFeed = onKeyChanged<DropFeedEntry[]>('drop-feed', (value) => {
      setFeed(value ?? []);
    });
    const unsubTokens = onKeyChanged('auth.tokens', (value) => {
      setSignedIn(!!value);
    });
    const unsubMembership = onKeyChanged<{ displayName: string } | null>(
      'auth.primaryMembership',
      (value) => {
        setDisplayName(value?.displayName ?? null);
      },
    );
    const unsubChar = onKeyChanged<ActiveCharacter | null>(
      'auth.activeCharacter',
      (value) => {
        setActiveCharacter(value ?? null);
      },
    );
    const unsubAuthState = onKeyChanged<AuthState>('auth.state', (value) => {
      const next = value ?? 'signed-out';
      setAuthState(next);
      setExpiredBannerDismissed(false);
    });
    const unsubManifest = onKeyChanged<boolean>('manifest.ready', (value) => {
      setManifestReady(value === true);
    });
    const unsubManifestProgress = onKeyChanged<ManifestProgress>(
      'manifest.progress',
      (value) => {
        setManifestProgress(value);
      },
    );
    const unsubAutolockFailed = onKeyChanged<AutolockFailedPayload>(
      'autolock.failed.last',
      (value) => {
        setAutolockFailed(value);
      },
    );
    return () => {
      unsubFeed();
      unsubTokens();
      unsubMembership();
      unsubChar();
      unsubAuthState();
      unsubManifest();
      unsubManifestProgress();
      unsubAutolockFailed();
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Consume pendingNavigation (written by the popup when a user clicks a drop
  // row). Switches tab, scrolls to the target row, briefly highlights it,
  // then clears the storage key so a dashboard reload doesn't re-trigger.
  useEffect(() => {
    if (!manifestReady) return;
    const nav = loadAndMigratePendingNavigation();
    if (!nav) return;
    removeItem('pendingNavigation');
    setTab(nav.tab);
    if (nav.instanceId) {
      const id = nav.instanceId;
      setHighlightInstanceId(id);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-instance-id="${CSS.escape(id)}"]`);
        if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      const timer = window.setTimeout(() => setHighlightInstanceId(null), 1500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [manifestReady]);

  useEffect(() => {
    if (!manifestReady) return;
    if (taxonomy !== null) return;
    let cancelled = false;
    void (async () => {
      const resp = await send<{ ok: boolean; payload: ArmorTaxonomyPayload }>({
        type: 'get-armor-taxonomy',
      });
      if (!cancelled && resp?.ok) setTaxonomy(resp.payload);
    })();
    return () => {
      cancelled = true;
    };
  }, [manifestReady, taxonomy]);

  const handleAutoLockToggle = useCallback((next: boolean) => {
    setAutoLockOnArmorMatch(next);
    const config = loadScoringConfig();
    saveScoringConfig({ ...config, autoLockOnArmorMatch: next });
  }, []);

  const handleSignIn = useCallback(async () => {
    setSignInPending(true);
    setSignInError(null);
    const response = await send<{ ok: boolean; error?: string }>({ type: 'auth-start' });
    setSignInPending(false);
    if (!response?.ok) {
      setSignInError(response?.error ?? 'Sign-in failed');
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await send({ type: 'auth-logout' });
  }, []);

  const handlePollNow = useCallback(async () => {
    await send({ type: 'trigger-poll-now' });
  }, []);

  const showExpiredBanner = authState === 'expired' && !expiredBannerDismissed;
  const showAutolockFailedBanner =
    autolockFailed !== null && autolockFailed.at !== autolockFailedDismissedAt;

  if (!manifestReady) {
    return (
      <ManifestLoadingCard
        progress={manifestProgress}
        onRetry={() => void send({ type: 'retry-manifest' })}
      />
    );
  }

  return (
    <div className="d-cursor-root relative min-h-screen bg-d-bg-base text-d-text font-outfit">
      <SacredBg opacity={0.4} />
      <div className="relative z-10">
        {showExpiredBanner && (
          <SessionExpiredBanner
            onSignIn={handleSignIn}
            onDismiss={() => setExpiredBannerDismissed(true)}
            pending={signInPending}
          />
        )}
        {showAutolockFailedBanner && autolockFailed && (
          <AutolockFailedBanner
            itemName={autolockFailed.itemName}
            onDismiss={() => setAutolockFailedDismissedAt(autolockFailed.at)}
          />
        )}

        <TopBar
          signedIn={signedIn}
          displayName={displayName}
          activeCharacter={activeCharacter}
          version={pkg.version}
          onSignOut={handleSignOut}
        />

        <main className="max-w-[1120px] mx-auto px-7 py-7 space-y-6">
          {!signedIn ? (
            <SignInPanel
              pending={signInPending}
              error={signInError}
              onSignIn={handleSignIn}
            />
          ) : (
            <>
              <TabNav active={tab} onChange={setTab} />

              {tab === 'drops' && (
                <DropsTab
                  feed={feed}
                  typeFilter={typeFilter}
                  matchFilter={matchFilter}
                  showExotic={showExotic}
                  visibleTiers={visibleTiers}
                  nowTick={nowTick}
                  highlightInstanceId={highlightInstanceId}
                  onTypeFilterChange={setTypeFilter}
                  onMatchFilterChange={setMatchFilter}
                  onToggleExotic={() => setShowExotic((v) => !v)}
                  onToggleTier={(tier) =>
                    setVisibleTiers((prev) => {
                      const next = new Set(prev);
                      if (next.has(tier)) next.delete(tier);
                      else next.add(tier);
                      return next;
                    })
                  }
                  onClearFeed={() => {
                    setItem('drop-feed', []);
                    setFeed([]);
                  }}
                  onLockDrop={(instanceId) => {
                    void send({ type: 'lock-drop', payload: { instanceId } });
                  }}
                  onPollNow={handlePollNow}
                />
              )}

              {tab === 'armor' && (
                <ArmorTab
                  taxonomy={taxonomy}
                  autoLockOnArmorMatch={autoLockOnArmorMatch}
                  onAutoLockToggle={handleAutoLockToggle}
                />
              )}

              {tab === 'settings' && (
                <SettingsTab
                  displayName={displayName}
                  onSignOut={handleSignOut}
                />
              )}
            </>
          )}

          <Divider gold filled />
          <footer className="text-d-11 uppercase tracking-d-wide text-d-text-dim text-center pt-2">
            Cryptarch · Loot Appraiser · v{pkg.version}
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            Sub-components                           */
/* ------------------------------------------------------------------ */

function TopBar({
  signedIn,
  displayName,
  activeCharacter,
  version,
  onSignOut,
}: {
  signedIn: boolean;
  displayName: string | null;
  activeCharacter: ActiveCharacter | null;
  version: string;
  onSignOut: () => void;
}): JSX.Element {
  const emblemIcon = activeCharacter?.emblemPath
    ? activeCharacter.emblemPath.startsWith('http')
      ? activeCharacter.emblemPath
      : `https://www.bungie.net${activeCharacter.emblemPath}`
    : null;
  return (
    <header className="border-b border-d-hairline">
      <div className="max-w-[1120px] mx-auto px-7 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src={chrome.runtime.getURL('icons/icon48.png')}
            alt=""
            className="w-7 h-7 border border-d-gold-line flex-shrink-0"
            aria-hidden
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-d-14 font-light uppercase tracking-d-hero text-d-text truncate">
              Cryptarch
            </span>
            <span className="text-d-10 uppercase tracking-d-wide text-d-text-muted">
              Loot Appraiser · v{version}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {signedIn && displayName && (
            <div className="flex items-center gap-2 text-d-12 uppercase tracking-d-wide text-d-text-sec">
              {emblemIcon ? (
                <img
                  src={emblemIcon}
                  alt=""
                  aria-hidden
                  className="w-8 h-8 border border-d-hairline flex-shrink-0"
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <span
                  aria-hidden
                  className={`w-[6px] h-[6px] ${signedIn ? 'bg-d-keep' : 'bg-d-text-dim'}`}
                />
              )}
              <span className="truncate max-w-[220px]">{displayName}</span>
            </div>
          )}
          {signedIn && (
            <Btn variant="ghost" small onClick={onSignOut}>
              Sign Out
            </Btn>
          )}
        </div>
      </div>
    </header>
  );
}

function TabNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}): JSX.Element {
  return (
    <nav className="flex border-b border-d-hairline -mx-7 px-7">
      <TabButton active={active === 'drops'} onClick={() => onChange('drops')}>
        Drops
      </TabButton>
      <TabButton active={active === 'armor'} onClick={() => onChange('armor')}>
        Armor
      </TabButton>
      <TabButton active={active === 'settings'} onClick={() => onChange('settings')}>
        Settings
      </TabButton>
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-6 py-3.5 text-d-12 font-medium uppercase tracking-d-widest border-b-2 -mb-px transition-colors duration-d-fast ${
        active
          ? 'border-d-gold text-d-gold d-text-shadow-tab'
          : 'border-transparent text-d-text-muted hover:text-d-text'
      }`}
    >
      {children}
    </button>
  );
}

/* ----- Sign-in panel (shown when !signedIn) ----- */

function SignInPanel({
  pending,
  error,
  onSignIn,
}: {
  pending: boolean;
  error: string | null;
  onSignIn: () => void;
}): JSX.Element {
  return (
    <Panel accent="gold" ticks padded={false} className="text-center px-8 py-10">
      <div className="space-y-4">
        <Headline size="md">Sign in with Bungie.net</Headline>
        <p className="text-d-12 text-d-text-sec max-w-md mx-auto leading-relaxed">
          Cryptarch needs read access to your Destiny 2 inventory so it can detect new
          drops. You'll be prompted to authorize in a Chrome popup.
        </p>
        <div className="flex justify-center">
          <BracketBtn onClick={onSignIn} disabled={pending}>
            {pending ? 'Waiting for Bungie…' : 'Sign in with Bungie.net'}
          </BracketBtn>
        </div>
        {error && (
          <div className="text-d-11 text-d-shard uppercase tracking-d-wide">{error}</div>
        )}
      </div>
    </Panel>
  );
}

/* ----- Drops tab ----- */

interface DropsTabProps {
  feed: DropFeedEntry[];
  typeFilter: DropTypeFilter;
  matchFilter: DropMatchFilter;
  showExotic: boolean;
  visibleTiers: Set<TierLetter>;
  nowTick: number;
  highlightInstanceId: string | null;
  onTypeFilterChange: (t: DropTypeFilter) => void;
  onMatchFilterChange: (m: DropMatchFilter) => void;
  onToggleExotic: () => void;
  onToggleTier: (tier: TierLetter) => void;
  onClearFeed: () => void;
  onLockDrop: (instanceId: string) => void;
  onPollNow: () => void;
}

function DropsTab(props: DropsTabProps): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Headline size="lg">Drop Log</Headline>
        <Btn variant="ghost" small onClick={props.onPollNow}>
          Poll Now
        </Btn>
      </div>
      <p className="text-d-12 text-d-text-muted uppercase tracking-d-wide">
        Updates every 30ish seconds. New drops appear below as Cryptarch scores them.
      </p>

      {import.meta.env.MODE === 'development' && <WishlistTestPanel />}

      <Panel accent="neutral" ticks>
        <DropLogPanel
          feed={props.feed}
          typeFilter={props.typeFilter}
          matchFilter={props.matchFilter}
          showExotic={props.showExotic}
          visibleTiers={props.visibleTiers}
          nowTick={props.nowTick}
          highlightInstanceId={props.highlightInstanceId}
          onTypeFilterChange={props.onTypeFilterChange}
          onMatchFilterChange={props.onMatchFilterChange}
          onToggleExotic={props.onToggleExotic}
          onToggleTier={props.onToggleTier}
          onClearFeed={props.onClearFeed}
          onLockDrop={props.onLockDrop}
        />
      </Panel>
    </div>
  );
}

/* ----- Armor tab ----- */

function ArmorTab({
  taxonomy,
  autoLockOnArmorMatch,
  onAutoLockToggle,
}: {
  taxonomy: ArmorTaxonomyPayload | null;
  autoLockOnArmorMatch: boolean;
  onAutoLockToggle: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <Headline size="lg">Armor Rules</Headline>
      <p className="text-d-12 text-d-text-muted uppercase tracking-d-wide">
        Rules describe which armor drops you want auto-locked.
      </p>
      <Panel accent="gold" ticks>
        <RulesPanel
          taxonomy={taxonomy}
          autoLockOnArmorMatch={autoLockOnArmorMatch}
          onAutoLockToggle={onAutoLockToggle}
        />
      </Panel>
    </div>
  );
}

/* ----- Settings tab ----- */

function SettingsTab({
  displayName,
  onSignOut,
}: {
  displayName: string | null;
  onSignOut: () => void;
}): JSX.Element {
  return (
    <div className="space-y-6">
      <Headline size="lg">Notification Settings</Headline>

      <div className="space-y-2">
        <Headline size="md">Wishlist Coverage</Headline>
        {/* Brief #23 follow-up: keep the default panel padding so the inner
            Notification Settings + Custom GitHub headers (each only px-1
            self-padded) get real breathing room from the panel border. */}
        <Panel accent="gold" ticks>
          <WeaponsPanel />
        </Panel>
      </div>

      <div className="space-y-2">
        <Headline size="md">Bungie Account</Headline>
        <Panel accent="neutral">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-d-11 uppercase tracking-d-wide text-d-text-muted">
                Signed in as
              </span>
              <span className="text-d-14 text-d-text truncate">
                {displayName ?? '—'}
              </span>
            </div>
            <Btn variant="danger" onClick={onSignOut}>
              Disconnect
            </Btn>
          </div>
        </Panel>
      </div>
    </div>
  );
}
