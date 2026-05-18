// Angular-edge grade badge. clip-path produces the right-edge slash;
// minWidth keeps the badge from collapsing on short labels. Four variants
// mirror DropFeedEntry grade signals.

type Grade = 'god' | 'keep' | 'exotic' | 'shard';

interface GradeBadgeProps {
  grade: Grade;
  // Compact variant for cramped surfaces (popup rows). ~20% smaller than the
  // default; same label, tighter padding + shorter min-width.
  small?: boolean;
  className?: string;
}

const VARIANTS: Record<
  Grade,
  { bg: string; fg: string; label: string; glow?: string }
> = {
  god:    { bg: 'rgba(206,174,51,0.22)',  fg: '#f5d96e', label: 'God Roll', glow: '0 0 12px rgba(206,174,51,0.30)' },
  keep:   { bg: 'rgba(90,158,111,0.12)',  fg: '#5a9e6f', label: 'Keep' },
  exotic: { bg: 'rgba(212,175,55,0.12)',  fg: '#e8c948', label: 'Exotic', glow: '0 0 10px rgba(212,175,55,0.25)' },
  shard:  { bg: 'rgba(194,58,58,0.12)',   fg: '#e06060', label: 'Shard' },
};

export function GradeBadge({ grade, small = false, className = '' }: GradeBadgeProps): JSX.Element {
  const v = VARIANTS[grade];
  const sizing = small
    ? 'min-w-[54px] h-[20px] text-d-9'
    : 'min-w-[68px] h-[26px] text-d-11';
  const padding = small ? '0 12px 0 6px' : '0 16px 0 8px';
  return (
    <span
      className={`inline-flex items-center justify-center ${sizing} font-medium uppercase tracking-d-widest ${className}`}
      style={{
        background: v.bg,
        color: v.fg,
        padding,
        clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)',
        boxShadow: v.glow ?? 'none',
      }}
    >
      {v.label}
    </span>
  );
}
