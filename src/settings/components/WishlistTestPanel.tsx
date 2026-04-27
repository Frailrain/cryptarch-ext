import { useCallback, useState } from 'react';
import type { TierLetter, WishlistMatch } from '@/shared/types';
import { send } from '@/shared/messaging';

// In-page wrapper around the cryptarchDebug.testMatch / testFallback console
// helpers. Same code paths under the hood (re-exported from
// background/debug-wishlists.ts and called via SW message handlers); this just
// renders the results inline so verifying multi-source matcher behavior doesn't
// require opening the SW devtools console.

interface CacheSummaryRow {
  id: string;
  name: string;
  entryCount: number;
  enabled: boolean;
}

type MultiSourcePayload =
  | {
      ok: true;
      // Brief #14 Part E redesign: which path produced the test drop.
      // 'inventory' = real weapon from user's profile (preferred). 'synthesized'
      // = perks built from wishlist source data (fallback when user isn't
      // signed in, has no qualifying inventory weapon, or manifest unavailable).
      source?: 'inventory' | 'synthesized';
      message?: string;
      itemHash: number;
      itemName: string | null;
      wishlistMatches: WishlistMatch[];
      weaponTier?: TierLetter;
      reasons?: string[];
      perks?: number[];
    }
  | { ok: false; message: string; diagnostic?: CacheSummaryRow[] };

interface FallbackPayload {
  wishlistMatches: WishlistMatch[];
  reasons: string[];
}

type ArmorPayload =
  | {
      ok: true;
      itemHash: number;
      itemName: string;
      armorMatched: boolean | null;
      armorClass: string | null;
      armorSet: string | null;
      armorArchetype: string | null;
      armorTertiary: string | null;
      armorTier: number | null;
      isExotic: boolean;
      matchedRule: string | null;
      reasons: string[];
    }
  | { ok: false; message: string };

type RunState = 'idle' | 'running';
type ResultState =
  | { kind: 'none' }
  | { kind: 'multi'; data: MultiSourcePayload }
  | { kind: 'fallback'; data: FallbackPayload }
  | { kind: 'armor'; data: ArmorPayload }
  | { kind: 'error'; message: string };

export function WishlistTestPanel() {
  const [multiState, setMultiState] = useState<RunState>('idle');
  const [fallbackState, setFallbackState] = useState<RunState>('idle');
  const [armorState, setArmorState] = useState<RunState>('idle');
  const [result, setResult] = useState<ResultState>({ kind: 'none' });

  const runMultiSource = useCallback(async () => {
    setMultiState('running');
    const response = await send<{ ok: boolean; payload?: MultiSourcePayload; error?: string }>({
      type: 'wishlist-test-multi-source',
    });
    setMultiState('idle');
    if (!response?.ok || !response.payload) {
      setResult({ kind: 'error', message: response?.error ?? 'Test failed (no response)' });
      return;
    }
    setResult({ kind: 'multi', data: response.payload });
  }, []);

  const runFallback = useCallback(async () => {
    setFallbackState('running');
    const response = await send<{ ok: boolean; payload?: FallbackPayload; error?: string }>({
      type: 'wishlist-test-fallback',
    });
    setFallbackState('idle');
    if (!response?.ok || !response.payload) {
      setResult({ kind: 'error', message: response?.error ?? 'Test failed (no response)' });
      return;
    }
    setResult({ kind: 'fallback', data: response.payload });
  }, []);

  const runArmor = useCallback(async () => {
    setArmorState('running');
    const response = await send<{ ok: boolean; payload?: ArmorPayload; error?: string }>({
      type: 'wishlist-test-armor',
    });
    setArmorState('idle');
    if (!response?.ok || !response.payload) {
      setResult({ kind: 'error', message: response?.error ?? 'Test failed (no response)' });
      return;
    }
    setResult({ kind: 'armor', data: response.payload });
  }, []);

  return (
    <div className="rounded-lg border border-bg-border bg-bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Wishlist matcher test</div>
          <div className="text-xs text-text-muted">
            Synthesizes a drop, runs it through the live matcher, and appends it to the drop log
            below (prefixed with [Test]). Results reflect your current enabled-source
            configuration.
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => void runMultiSource()}
            disabled={
              multiState === 'running' || fallbackState === 'running' || armorState === 'running'
            }
            className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {multiState === 'running' ? 'Testing…' : 'Run multi-source test'}
          </button>
          <button
            onClick={() => void runFallback()}
            disabled={
              multiState === 'running' || fallbackState === 'running' || armorState === 'running'
            }
            className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fallbackState === 'running' ? 'Testing…' : 'Run fallback test'}
          </button>
          <button
            onClick={() => void runArmor()}
            disabled={
              multiState === 'running' || fallbackState === 'running' || armorState === 'running'
            }
            className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {armorState === 'running' ? 'Fetching inventory…' : 'Run armor test'}
          </button>
        </div>
      </div>

      {result.kind === 'error' && (
        <div className="text-xs text-red-400">{result.message}</div>
      )}

      {result.kind === 'multi' && <MultiSourceResultView data={result.data} />}
      {result.kind === 'fallback' && <FallbackResultView data={result.data} />}
      {result.kind === 'armor' && <ArmorResultView data={result.data} />}
    </div>
  );
}

function ArmorResultView({ data }: { data: ArmorPayload }) {
  if (!data.ok) {
    return (
      <div className="rounded border border-bg-border bg-bg-primary p-3 text-xs text-text-muted">
        {data.message}
      </div>
    );
  }
  const subtitle = [
    data.armorClass,
    data.armorSet,
    data.armorArchetype,
    data.armorTertiary,
    data.armorTier ? `T${data.armorTier}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rounded border border-bg-border bg-bg-primary p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-text-primary">
          {data.itemName} (#{data.itemHash})
        </span>
        {data.isExotic && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50">
            Exotic
          </span>
        )}
        {data.armorMatched === true && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border bg-grade-s/20 text-grade-s border-grade-s/50">
            Matched
          </span>
        )}
        {data.armorMatched === false && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-bg-border text-text-muted">
            No match
          </span>
        )}
      </div>
      {subtitle && <div className="text-text-muted">{subtitle}</div>}
      {data.matchedRule && (
        <div className="text-text-muted">
          <span className="font-medium">Matched rule:</span> {data.matchedRule}
        </div>
      )}
      {data.reasons.length > 0 && (
        <div className="text-text-muted">
          <span className="font-medium">Reasons:</span> {data.reasons.join('; ')}
        </div>
      )}
    </div>
  );
}

function MultiSourceResultView({ data }: { data: MultiSourcePayload }) {
  if (!data.ok) {
    return (
      <div className="rounded border border-bg-border bg-bg-primary p-3 text-xs text-text-muted space-y-2">
        <div>{data.message}</div>
        {data.diagnostic && (
          <div className="space-y-1">
            <div className="font-medium text-text-primary">
              SW cache snapshot ({data.diagnostic.length} {data.diagnostic.length === 1 ? 'list' : 'lists'}):
            </div>
            {data.diagnostic.length === 0 ? (
              <div className="text-red-400">
                Cache is empty. Storage write must not be reaching the SW. Refresh a source in the
                Wishlists tab and try again.
              </div>
            ) : (
              <ul className="space-y-0.5 pl-3">
                {data.diagnostic.map((row) => (
                  <li key={row.id}>
                    <span className={row.enabled ? 'text-rahool-blue' : 'text-text-muted'}>
                      {row.name}
                    </span>
                    {' — '}
                    <span className="text-text-primary">{row.entryCount.toLocaleString()} rolls</span>
                    {!row.enabled && <span className="text-text-muted"> (disabled)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }
  const itemDisplay = data.itemName
    ? `${data.itemName} (#${data.itemHash})`
    : `#${data.itemHash}`;
  return (
    <div className="rounded border border-bg-border bg-bg-primary p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-text-primary">{itemDisplay}</span>
        {data.weaponTier && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-bg-border text-text-primary">
            Tier {data.weaponTier}
          </span>
        )}
        {data.source && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${
              data.source === 'inventory'
                ? 'bg-rahool-blue/15 text-rahool-blue border-rahool-blue/40'
                : 'border-bg-border text-text-muted'
            }`}
            title={
              data.source === 'inventory'
                ? 'Real weapon from your profile — actual rolled perks'
                : 'No qualifying inventory weapon — perks synthesized from wishlist data'
            }
          >
            {data.source === 'inventory' ? 'From inventory' : 'Synthesized'}
          </span>
        )}
      </div>
      {data.message && <div className="text-text-muted">{data.message}</div>}

      {data.wishlistMatches.length > 0 ? (
        <div className="space-y-1">
          <div className="text-text-muted">Matching sources ({data.wishlistMatches.length}):</div>
          <ul className="space-y-1 pl-3">
            {data.wishlistMatches.map((m) => (
              <li key={m.sourceId} className="text-text-primary">
                <span className="text-rahool-blue">{m.sourceName}</span>
                {m.weaponTier && (
                  <span className="text-text-muted"> [Tier {m.weaponTier}]</span>
                )}
                {m.notes && <span className="text-text-muted"> — {m.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-text-muted">No keeper matches (matcher returned an empty array).</div>
      )}

      {data.reasons && data.reasons.length > 0 && (
        <div className="text-text-muted">
          <span className="font-medium">Reasons:</span> {data.reasons.join('; ')}
        </div>
      )}

      {data.perks && (
        <div className="text-text-muted break-all">
          <span className="font-medium">Perks used:</span>{' '}
          {data.perks.length > 0 ? data.perks.join(', ') : '(none)'}
        </div>
      )}
    </div>
  );
}

function FallbackResultView({ data }: { data: FallbackPayload }) {
  // Brief #12.5: post-grade-removal, the fallback test verifies that an
  // unrecognized hash produces no matches (the canonical "we have nothing
  // to say about this drop" signal). Pre-#12.5 this was "expected grade B".
  const expected = data.wishlistMatches.length === 0;
  return (
    <div className="rounded border border-bg-border bg-bg-primary p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-text-primary">Fallback test</span>
        {expected ? (
          <span className="text-rahool-blue">no match ✓</span>
        ) : (
          <span className="text-red-400">
            unexpected: matched {data.wishlistMatches.length} source(s)
          </span>
        )}
      </div>
      <div className="text-text-muted">
        wishlistMatches:{' '}
        {data.wishlistMatches.length === 0 ? (
          <span className="text-rahool-blue">empty ✓</span>
        ) : (
          <span className="text-red-400">
            {data.wishlistMatches.length} match(es) — should be empty for unrecognized hash
          </span>
        )}
      </div>
      {data.reasons.length > 0 && (
        <div className="text-text-muted">
          <span className="font-medium">Reasons:</span> {data.reasons.join('; ')}
        </div>
      )}
    </div>
  );
}

