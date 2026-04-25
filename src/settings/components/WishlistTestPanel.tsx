import { useCallback, useState } from 'react';
import type { Grade, WishlistMatch } from '@/shared/types';
import { send } from '@/shared/messaging';

// In-page wrapper around the cryptarchDebug.testMatch / testFallback console
// helpers. Same code paths under the hood (re-exported from
// background/debug-wishlists.ts and called via SW message handlers); this just
// renders the results inline so verifying multi-source matcher behavior doesn't
// require opening the SW devtools console.

type MultiSourcePayload =
  | {
      ok: true;
      itemHash: number;
      itemName: string | null;
      grade: Grade | null;
      wishlistMatches: WishlistMatch[];
      reasons: string[];
      perks: number[];
    }
  | { ok: false; message: string };

interface FallbackPayload {
  grade: Grade | null;
  wishlistMatches: WishlistMatch[];
  reasons: string[];
}

type RunState = 'idle' | 'running';
type ResultState =
  | { kind: 'none' }
  | { kind: 'multi'; data: MultiSourcePayload }
  | { kind: 'fallback'; data: FallbackPayload }
  | { kind: 'error'; message: string };

export function WishlistTestPanel() {
  const [multiState, setMultiState] = useState<RunState>('idle');
  const [fallbackState, setFallbackState] = useState<RunState>('idle');
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
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => void runMultiSource()}
            disabled={multiState === 'running' || fallbackState === 'running'}
            className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {multiState === 'running' ? 'Testing…' : 'Run multi-source test'}
          </button>
          <button
            onClick={() => void runFallback()}
            disabled={multiState === 'running' || fallbackState === 'running'}
            className="text-xs px-3 py-1.5 rounded border border-bg-border text-text-muted hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fallbackState === 'running' ? 'Testing…' : 'Run fallback test'}
          </button>
        </div>
      </div>

      {result.kind === 'error' && (
        <div className="text-xs text-red-400">{result.message}</div>
      )}

      {result.kind === 'multi' && <MultiSourceResultView data={result.data} />}
      {result.kind === 'fallback' && <FallbackResultView data={result.data} />}
    </div>
  );
}

function MultiSourceResultView({ data }: { data: MultiSourcePayload }) {
  if (!data.ok) {
    return (
      <div className="rounded border border-bg-border bg-bg-primary p-3 text-xs text-text-muted">
        {data.message}
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
        <GradeChip grade={data.grade} />
      </div>

      {data.wishlistMatches.length > 0 ? (
        <div className="space-y-1">
          <div className="text-text-muted">Matching sources ({data.wishlistMatches.length}):</div>
          <ul className="space-y-1 pl-3">
            {data.wishlistMatches.map((m) => (
              <li key={m.sourceId} className="text-text-primary">
                <span className="text-rahool-blue">{m.sourceName}</span>
                {m.notes && <span className="text-text-muted"> — {m.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-text-muted">No keeper matches (matcher returned an empty array).</div>
      )}

      {data.reasons.length > 0 && (
        <div className="text-text-muted">
          <span className="font-medium">Reasons:</span> {data.reasons.join('; ')}
        </div>
      )}

      <div className="text-text-muted break-all">
        <span className="font-medium">Perks used:</span>{' '}
        {data.perks.length > 0 ? data.perks.join(', ') : '(none)'}
      </div>
    </div>
  );
}

function FallbackResultView({ data }: { data: FallbackPayload }) {
  const expected = data.grade === 'B';
  return (
    <div className="rounded border border-bg-border bg-bg-primary p-3 space-y-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-text-primary">Fallback test</span>
        <GradeChip grade={data.grade} />
        {expected ? (
          <span className="text-rahool-blue">expected B</span>
        ) : (
          <span className="text-red-400">unexpected (expected B)</span>
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

function GradeChip({ grade }: { grade: Grade | null }) {
  if (!grade) {
    return (
      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-bg-border text-text-muted">
        none
      </span>
    );
  }
  const cls =
    grade === 'S'
      ? 'bg-grade-s/20 text-grade-s border-grade-s/40'
      : grade === 'A'
        ? 'bg-grade-a/20 text-grade-a border-grade-a/40'
        : grade === 'B'
          ? 'bg-grade-b/20 text-grade-b border-grade-b/40'
          : grade === 'D'
            ? 'bg-red-500/20 text-red-400 border-red-500/40'
            : 'bg-bg-primary text-text-muted border-bg-border';
  return (
    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {grade}
    </span>
  );
}
