interface Props {
  itemName: string;
  onDismiss: () => void;
}

export function AutolockFailedBanner({ itemName, onDismiss }: Props) {
  return (
    <div
      role="alert"
      className="border-b border-amber-500/30 bg-amber-500/10 text-amber-200"
    >
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
        <span className="text-sm flex-1">
          Couldn't auto-lock <span className="font-medium">{itemName}</span>. Check your
          vault — you may need to lock it manually.
        </span>
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
