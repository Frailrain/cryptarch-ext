// Angular two-cell ON/OFF toggle. Filled cell indicates state. Looks like a
// Destiny menu indicator, not an iOS switch. The whole button is clickable.

interface ToggleProps {
  on: boolean;
  onToggle: () => void;
  ariaLabel?: string;
  className?: string;
}

export function Toggle({ on, onToggle, ariaLabel, className = '' }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={`inline-grid grid-cols-[34px_34px] h-[22px] border border-d-hairline bg-d-bg-deep p-0 ${className}`}
    >
      <span
        className={`flex items-center justify-center text-d-9 font-medium uppercase tracking-d-wide border-r border-d-hairline transition-colors duration-d-fast ${
          on
            ? 'bg-d-gold-dim text-d-gold d-text-shadow-gold'
            : 'bg-transparent text-d-text-dim'
        }`}
      >
        On
      </span>
      <span
        className={`flex items-center justify-center text-d-9 font-medium uppercase tracking-d-wide transition-colors duration-d-fast ${
          on ? 'bg-transparent text-d-text-dim' : 'bg-d-bg-elevated text-d-text-sec'
        }`}
      >
        Off
      </span>
    </button>
  );
}
