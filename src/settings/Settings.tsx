import { useCallback, useEffect, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { isLoggedIn } from '@/core/bungie/auth';
import { loadAuthState, loadPrimaryMembership, type AuthState } from '@/core/storage/tokens';
import { getItem, onKeyChanged } from '@/adapters/storage';
import { send } from '@/shared/messaging';
import type { DropFeedEntry } from '@/shared/types';
import { DropLogPanel, type DropTypeFilter, type DropMatchFilter } from './tabs/DropLogPanel';
import { RulesPanel } from './tabs/RulesPanel';
import { WishlistsPanel } from './tabs/WishlistsPanel';
import { WishlistTestPanel } from './components/WishlistTestPanel';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';
import { ManifestLoadingCard } from './components/ManifestLoadingCard';
import { AutolockFailedBanner } from './components/AutolockFailedBanner';
import type { ManifestProgress } from '@/core/bungie/manifest';
import type {
  ArmorTaxonomyPayload,
  AutolockFailedPayload,
  PendingNavigation,
} from '@/shared/types';
import { removeItem } from '@/adapters/storage';
import { loadScoringConfig, saveScoringConfig } from '@/core/storage/scoring-config';

// Brief #12: tab labels reorganized to put weapon configuration on equal
// footing with armor. "Rules" → "Armor", "Wishlists" folded into "Weapons".
// Component filenames (RulesPanel, WishlistsPanel) deliberately kept — the
// internal naming reflects what the components manage (armor rules / wishlist
// sources), the tab labels reflect the user-facing mental model (Armor /
// Weapons). Renaming the files would have churned ~100 lines of imports for
// no functional benefit.
type Tab = 'drops' | 'armor' | 'weapons';

// Migrate pre-#12 pendingNavigation values written by an older popup before
// the tab rename. Returns null if the stored value is missing or unrecognized.
function loadAndMigratePendingNavigation(): PendingNavigation | null {
  const raw = getItem<{ tab: string; instanceId?: string }>('pendingNavigation');
  if (!raw) return null;
  const migrated =
    raw.tab === 'rules' ? 'armor' : raw.tab === 'wishlists' ? 'weapons' : raw.tab;
  if (migrated !== 'drops' && migrated !== 'armor' && migrated !== 'weapons') {
    return null;
  }
  return { tab: migrated, instanceId: raw.instanceId };
}

export function Settings() {
  const [signedIn, setSignedIn] = useState<boolean>(() => isLoggedIn());
  const [displayName, setDisplayName] = useState<string | null>(
    () => loadPrimaryMembership()?.displayName ?? null,
  );
  const [feed, setFeed] = useState<DropFeedEntry[]>(() => loadFeed());
  const [signInPending, setSignInPending] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [typeFilter, setTypeFilter] = useState<DropTypeFilter>('all');
  const [matchFilter, setMatchFilter] = useState<DropMatchFilter>('all');
  const [showA, setShowA] = useState(true);
  const [showB, setShowB] = useState(false);
  const [showExotic, setShowExotic] = useState(true);
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
    const unsubAuthState = onKeyChanged<AuthState>('auth.state', (value) => {
      const next = value ?? 'signed-out';
      setAuthState(next);
      // Re-show the banner on every fresh expiry transition. Re-signing in
      // moves to 'signed-in' and re-expiring later flips back to 'expired';
      // this reset ensures the user sees the banner the second time too.
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
  // row). Switches tab, scrolls to the target row, briefly highlights it, then
  // clears the storage key so a dashboard reload doesn't re-trigger.
  useEffect(() => {
    if (!manifestReady) return;
    const nav = loadAndMigratePendingNavigation();
    if (!nav) return;
    removeItem('pendingNavigation');
    setTab(nav.tab);
    if (nav.instanceId) {
      const id = nav.instanceId;
      setHighlightInstanceId(id);
      // Defer scroll until after React renders the tab change.
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-instance-id="${CSS.escape(id)}"]`);
        if (el instanceof HTMLElement) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      const timer = window.setTimeout(() => setHighlightInstanceId(null), 1500);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [manifestReady]);

  // Fetch armor taxonomy (sets/archetypes/tertiaries) from the SW once the
  // manifest is ready. Cached at the Settings level so switching between
  // Drops and Rules tabs doesn't re-request. Re-fetched if manifest ever
  // transitions back to loading (shouldn't, but defensive).
  useEffect(() => {
    if (!manifestReady) return;
    if (taxonomy !== null) return;
    let cancelled = false;
    void (async () => {
      const resp = await send<{ ok: boolean; payload: ArmorTaxonomyPayload }>(
        { type: 'get-armor-taxonomy' },
      );
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
    <div className="min-h-screen bg-bg-primary text-text-primary">
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
      <header className="border-b border-bg-border">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={chrome.runtime.getURL('icons/icon48.png')}
              alt=""
              className="w-9 h-9 rounded"
              aria-hidden="true"
            />
            <div>
              <div className="text-lg font-semibold leading-tight">Cryptarch</div>
              <div className="text-xs text-text-muted">Loot Appraiser · Chrome edition</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://ko-fi.com/frailrain"
              target="_blank"
              rel="noopener noreferrer"
              title="Support on Ko-fi"
              className="text-xs text-text-muted hover:text-rahool-blue"
            >
              Buy me a coffee ☕
            </a>
            {signedIn && displayName && (
              <span className="text-sm text-text-muted">Signed in as {displayName}</span>
            )}
            {signedIn ? (
              <button
                onClick={handleSignOut}
                className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {!signedIn ? (
          <div className="rounded-lg border border-bg-border bg-bg-card p-8 text-center space-y-4">
            <h2 className="text-lg font-semibold">Sign in with Bungie.net</h2>
            <p className="text-sm text-text-muted max-w-md mx-auto">
              Cryptarch needs read access to your Destiny 2 inventory so it can detect new
              drops. You'll be prompted to authorize in a Chrome popup.
            </p>
            <button
              onClick={handleSignIn}
              disabled={signInPending}
              className="inline-flex items-center px-4 py-2 rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signInPending ? 'Waiting for Bungie…' : 'Sign in with Bungie.net'}
            </button>
            {signInError && (
              <div className="text-xs text-red-400">{signInError}</div>
            )}
          </div>
        ) : (
          <>
            <nav className="flex gap-1 border-b border-bg-border">
              <TabButton active={tab === 'drops'} onClick={() => setTab('drops')}>
                Drops
              </TabButton>
              <TabButton active={tab === 'armor'} onClick={() => setTab('armor')}>
                Armor
              </TabButton>
              <TabButton active={tab === 'weapons'} onClick={() => setTab('weapons')}>
                Weapons
              </TabButton>
            </nav>

            {tab === 'drops' && (
              <>
                <div className="rounded-lg border border-bg-border bg-bg-card p-4 flex items-center justify-between">
                  <div className="text-sm text-text-muted">
                    Updates every 30ish seconds. New drops appear below as Cryptarch scores them.
                  </div>
                  <button
                    onClick={handlePollNow}
                    className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary"
                  >
                    Poll now
                  </button>
                </div>

                <WishlistTestPanel />

                <DropLogPanel
                  feed={feed}
                  typeFilter={typeFilter}
                  matchFilter={matchFilter}
                  showA={showA}
                  showB={showB}
                  showExotic={showExotic}
                  nowTick={nowTick}
                  highlightInstanceId={highlightInstanceId}
                  onTypeFilterChange={setTypeFilter}
                  onMatchFilterChange={setMatchFilter}
                  onToggleA={() => setShowA((v) => !v)}
                  onToggleB={() => setShowB((v) => !v)}
                  onToggleExotic={() => setShowExotic((v) => !v)}
                />
              </>
            )}

            {tab === 'armor' && (
              <RulesPanel
                taxonomy={taxonomy}
                autoLockOnArmorMatch={autoLockOnArmorMatch}
                onAutoLockToggle={handleAutoLockToggle}
              />
            )}

            {tab === 'weapons' && <WishlistsPanel />}
          </>
        )}

        <footer className="text-xs text-text-muted text-center pt-6">
          Cryptarch · Chrome edition · v0.1.0
        </footer>
      </main>
    </div>
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
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px ${
        active
          ? 'border-rahool-blue text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
