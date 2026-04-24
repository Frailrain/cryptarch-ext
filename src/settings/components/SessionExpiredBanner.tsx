interface Props {
  onSignIn: () => void;
  onDismiss: () => void;
  pending: boolean;
}

export function SessionExpiredBanner({ onSignIn, onDismiss, pending }: Props) {
  return (
    <div
      role="alert"
      className="border-b border-amber-500/30 bg-amber-500/10 text-amber-200"
    >
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
        <span className="text-sm flex-1">
          Your Bungie session expired. Sign in again to resume drop tracking.
        </span>
        <button
          onClick={onSignIn}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Waiting for Bungie…' : 'Sign in'}
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-amber-300/70 hover:text-amber-200 text-lg leading-none px-1"
        >
          ×
        </button>
      </div>
    </div>
  );
}
