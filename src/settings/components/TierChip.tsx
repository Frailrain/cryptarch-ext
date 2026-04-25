import type { TierLetter } from '@/shared/types';

// Brief #12 Part F: per-weapon tier chip. Color palette mirrors the brief —
// gold for S, bright blue for A, decreasing emphasis through B/C/D, red-tinted
// for F. Distinct from the grade chip palette (which uses grade-s purple etc.)
// because tier and grade are different signals: grade is per-roll quality,
// tier is per-weapon-family ranking.
//
// Used in two contexts:
//   - Inline on Drop Log / Popup rows next to source-match chips (`size: sm`)
//   - In the Drop Log filter row as a toggle button (`active` prop drives the
//     dimmed-when-off state)

const TIER_COLORS: Record<TierLetter, { active: string; inactive: string }> = {
  S: {
    active: 'bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50',
    inactive: 'bg-bg-primary text-text-muted border-bg-border',
  },
  A: {
    active: 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/50',
    inactive: 'bg-bg-primary text-text-muted border-bg-border',
  },
  B: {
    active: 'bg-rahool-blue/10 text-rahool-blue/70 border-rahool-blue/30',
    inactive: 'bg-bg-primary text-text-muted border-bg-border',
  },
  C: {
    active: 'bg-text-muted/15 text-text-muted border-text-muted/30',
    inactive: 'bg-bg-primary text-text-muted/60 border-bg-border',
  },
  D: {
    active: 'bg-text-muted/10 text-text-muted/60 border-text-muted/20',
    inactive: 'bg-bg-primary text-text-muted/50 border-bg-border',
  },
  F: {
    active: 'bg-red-500/15 text-red-400/80 border-red-500/30',
    inactive: 'bg-bg-primary text-text-muted/50 border-bg-border',
  },
};

export function TierChip({
  tier,
  active = true,
  onClick,
  title,
}: {
  tier: TierLetter;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const colors = TIER_COLORS[tier];
  const cls = active ? colors.active : colors.inactive;
  const baseCls =
    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${baseCls} ${cls}`}
      >
        {tier}
      </button>
    );
  }
  return (
    <span title={title} className={`${baseCls} ${cls}`}>
      Tier {tier}
    </span>
  );
}
