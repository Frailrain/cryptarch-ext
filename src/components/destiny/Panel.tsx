import { Ticks } from './Ticks';

// Dark panel with optional 1px colored top accent + optional corner ticks.
// Used as the surface for grouped content on the dashboard.

type PanelAccent = 'gold' | 'exotic' | 'neutral' | null;

interface PanelProps {
  children: React.ReactNode;
  accent?: PanelAccent;
  ticks?: boolean;
  padded?: boolean;
  className?: string;
}

const ACCENT_BORDER: Record<Exclude<PanelAccent, null>, string> = {
  gold:    'border-t-d-gold-line',
  exotic:  'border-t-d-exotic-line',
  neutral: 'border-t-d-hairline',
};

export function Panel({
  children,
  accent = null,
  ticks = false,
  padded = true,
  className = '',
}: PanelProps): JSX.Element {
  const accentClass = accent ? `border-t ${ACCENT_BORDER[accent]}` : '';
  const padClass = padded ? 'p-5' : '';
  return (
    <div
      className={`relative bg-d-bg-panel border border-d-hairline ${accentClass} ${padClass} ${className}`}
    >
      {ticks && <Ticks />}
      {children}
    </div>
  );
}
