import type { ButtonHTMLAttributes } from 'react';

// Sharp-cornered button, uppercase + tracked, four variants. Ghost is the
// default for secondary actions; primary is gold for affirmative CTAs;
// danger is the shard-red for destructive (disconnect, delete); lock is
// the gold-tinted in-row lock button used on drop entries.

type BtnVariant = 'ghost' | 'primary' | 'danger' | 'lock';

interface BtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: BtnVariant;
  small?: boolean;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<BtnVariant, string> = {
  ghost:
    'bg-transparent text-d-text-sec border-d-hairline hover:bg-d-bg-elevated hover:text-d-text hover:border-white/15',
  primary:
    'bg-d-gold-dim text-d-gold border-d-gold-line hover:bg-d-gold-hover hover:text-d-gold-pale hover:border-d-gold',
  danger:
    'bg-transparent text-d-shard border-d-shard-line hover:bg-d-shard-dim',
  lock:
    'bg-d-gold-dim text-d-gold border-d-gold-line hover:bg-d-gold-hover hover:text-d-gold-bright hover:border-d-gold',
};

export function Btn({
  children,
  variant = 'ghost',
  small = false,
  className = '',
  ...rest
}: BtnProps): JSX.Element {
  const pad = small ? 'px-3 py-1' : 'px-4 py-2';
  const size = small ? 'text-d-11' : 'text-d-12';
  return (
    <button
      {...rest}
      className={`${pad} ${size} font-medium uppercase tracking-d-wide border transition-colors duration-d-fast ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
