import { useEffect, useState } from 'react';
import type { ManifestProgress, ManifestStage } from '@/core/bungie/manifest';

interface Props {
  onRetry: () => void;
  progress: ManifestProgress | null;
}

const STAGE_LABEL: Record<ManifestStage, string> = {
  idle: 'Preparing…',
  checking: 'Checking manifest version…',
  downloading: 'Downloading game data…',
  parsing: 'Parsing definitions…',
  saving: 'Saving to local storage…',
  done: 'Done',
  error: 'Download failed',
};

// First-boot indicator shown until chrome.storage's `manifest.ready` flag
// flips to true. Replaces the full options-page UI — the user can't do
// anything useful without the manifest anyway.
export function ManifestLoadingCard({ onRetry, progress }: Props) {
  // Retry button appears after 30s OR immediately on error.
  const [showRetry, setShowRetry] = useState(false);
  const isError = progress?.stage === 'error';

  useEffect(() => {
    if (isError) {
      setShowRetry(true);
      return;
    }
    const id = window.setTimeout(() => setShowRetry(true), 30_000);
    return () => window.clearTimeout(id);
  }, [isError]);

  const label = STAGE_LABEL[progress?.stage ?? 'idle'];
  const pct = progress?.pct ?? 0;
  const showBar = progress && progress.stage !== 'idle' && progress.stage !== 'error';

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-primary text-text-primary px-6">
      <div className="max-w-md w-full rounded-lg border border-bg-border bg-bg-card p-8 text-center space-y-4">
        {!isError && (
          <div className="flex justify-center">
            <div
              aria-hidden="true"
              className="w-10 h-10 rounded-full border-4 border-rahool-blue/20 border-t-rahool-blue animate-spin"
            />
          </div>
        )}
        <h2 className="text-lg font-semibold">
          {isError ? 'Download failed' : 'Downloading game data'}
        </h2>
        <p className="text-sm text-text-muted">
          {isError
            ? (progress?.error ?? 'Something went wrong while fetching Destiny 2 data.')
            : 'One-time setup — Cryptarch is fetching Destiny 2’s manifest so it can identify your drops.'}
        </p>
        {showBar && (
          <div className="space-y-1">
            <div className="h-1.5 bg-bg-border rounded overflow-hidden">
              <div
                className="h-full bg-rahool-blue transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-text-muted flex justify-between">
              <span>{label}</span>
              <span>{pct}%</span>
            </div>
          </div>
        )}
        {showRetry && (
          <button
            onClick={() => {
              setShowRetry(false);
              onRetry();
              window.setTimeout(() => setShowRetry(true), 30_000);
            }}
            className="inline-flex items-center px-4 py-2 rounded border border-bg-border text-sm hover:bg-bg-hover"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
