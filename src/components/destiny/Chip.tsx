import type { ButtonHTMLAttributes } from 'react';

// Filter chip — small, uppercase, hairline-bordered. Active state fills with
// the variant color at low opacity. Used for type filters, tier filters,
// exotic toggle, etc.

type ChipColor = 'gold' | 'exotic' | 'keep' | 'shard' | 'legendary' | 'neutral';

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  active?: boolean;
  color?: ChipColor;
  className?: string;
  children: React.ReactNode;
}

const COLOR_ACTIVE: Record<ChipColor, string> = {
  gold:      'text-d-gold border-d-gold-line bg-d-gold-dim',
  exotic:    'text-d-exotic border-d-exotic-line bg-d-exotic-dim',
  keep:      'text-d-keep border-d-keep-line bg-d-keep-dim',
  shard:     'text-d-shard border-d-shard-line bg-d-shard-dim',
  legendary: 'text-d-legendary border-d-legendary-line bg-d-legendary-dim',
  neutral:   'text-d-text border-white/20 bg-d-bg-elevated',
};

export function Chip({
  children,
  active = false,
  color = 'gold',
  className = '',
  ...rest
}: ChipProps): JSX.Element {
  const stateClass = active
    ? COLOR_ACTIVE[color]
    : 'text-d-text-muted border-d-hairline bg-transparent';
  return (
    <button
      type="button"
      {...rest}
      className={`px-3 py-1 text-d-11 font-medium uppercase tracking-d-wide border whitespace-nowrap transition-colors duration-d-fast ${stateClass} ${className}`}
    >
      {children}
    </button>
  );
}
