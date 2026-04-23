import { useCallback, useEffect, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { loadPrimaryMembership, loadTokens } from '@/core/storage/tokens';
import { onKeyChanged } from '@/adapters/storage';
import { send } from '@/shared/messaging';
import type { DropFeedEntry } from '@/shared/types';
import { DropLogPanel, type DropTypeFilter, type DropMatchFilter } from './tabs/DropLogPanel';

export function Settings() {
  const [signedIn, setSignedIn] = useState<boolean>(() => {
    const tokens = loadTokens();
    return !!tokens && tokens.refreshTokenExpiresAt > Date.now();
  });
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
    return () => {
      unsubFeed();
      unsubTokens();
      unsubMembership();
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => window.clearInterval(id);
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

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <header className="border-b border-bg-border">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center justify-center w-9 h-9 rounded font-semibold"
              style={{ background: '#D4A82C', color: '#0A0D12' }}
              aria-hidden="true"
            >
              C
            </span>
            <div>
              <div className="text-lg font-semibold leading-tight">Cryptarch</div>
              <div className="text-xs text-text-muted">Loot Appraiser · Chrome edition</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
            <div className="rounded-lg border border-bg-border bg-bg-card p-4 flex items-center justify-between">
              <div className="text-sm text-text-muted">
                Polling every minute. New drops appear below as Cryptarch scores them.
              </div>
              <button
                onClick={handlePollNow}
                className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary"
              >
                Poll now
              </button>
            </div>

            <DropLogPanel
              feed={feed}
              typeFilter={typeFilter}
              matchFilter={matchFilter}
              showA={showA}
              showB={showB}
              nowTick={nowTick}
              onTypeFilterChange={setTypeFilter}
              onMatchFilterChange={setMatchFilter}
              onToggleA={() => setShowA((v) => !v)}
              onToggleB={() => setShowB((v) => !v)}
            />
          </>
        )}

        <footer className="text-xs text-text-muted text-center pt-6">
          Cryptarch · Chrome edition · v0.1.0 (Session 1 — sign-in + polling + drop feed)
        </footer>
      </main>
    </div>
  );
}
