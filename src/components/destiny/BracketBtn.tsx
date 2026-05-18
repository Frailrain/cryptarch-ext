import type { ButtonHTMLAttributes } from 'react';

// Primary CTA framed with destiny2.com-style filled-triangle chevrons:
// ▶▶ LABEL ◀◀. Gold-tinted background + hairline gold border, hover
// brightens both. Two sizes — default for hero CTAs, small for inline.

interface BracketBtnProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  small?: boolean;
  fullWidth?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function BracketBtn({
  children,
  small = false,
  fullWidth = false,
  className = '',
  ...rest
}: BracketBtnProps): JSX.Element {
  const pad = small ? 'px-4 py-2' : 'px-7 py-3';
  const size = small ? 'text-d-11' : 'text-d-13';
  const chevronSize = small ? 'text-[10px]' : 'text-[12px]';
  const widthCls = fullWidth ? 'w-full' : '';
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 ${pad} ${size} ${widthCls} font-medium uppercase tracking-d-widest text-d-gold bg-d-gold-dim border border-d-gold-line transition-colors duration-d-fast hover:bg-d-gold-hover hover:text-d-gold-pale hover:border-d-gold ${className}`}
    >
      <span className={`${chevronSize} opacity-70 tracking-tighter`} aria-hidden>
        ▶▶
      </span>
      {children}
      <span className={`${chevronSize} opacity-70 tracking-tighter`} aria-hidden>
        ◀◀
      </span>
    </button>
  );
}
