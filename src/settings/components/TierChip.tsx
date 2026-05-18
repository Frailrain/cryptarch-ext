import type { TierLetter } from '@/shared/types';

// Brief #12 Part F: per-weapon tier chip. Brief #23 update: tokens migrated
// from legacy rahool-blue palette to Destiny-native d-* palette. S = gold
// (god-roll), A = legendary purple, B/C/D step down through muted greys,
// F = shard-red. Distinct per tier so a glance disambiguates rank.
//
// Used in two contexts:
//   - Inline on Drop Log / Popup rows next to source-match chips (`compact`)
//   - In the Drop Log filter row as a toggle button (`active` prop drives the
//     dimmed-when-off state)

// Brief #23 follow-up: S no longer uses gold — gold is reserved for exotics
// (and the GOD ROLL badge). S now reads as "best legendary" via a brighter
// purple, with A stepping down to the standard legendary fill.
const TIER_COLORS: Record<TierLetter, { active: string; inactive: string }> = {
  S: {
    active: 'bg-d-legendary-dim text-d-legendary-bright border-d-legendary-line',
    inactive: 'bg-transparent text-d-text-muted border-d-hairline',
  },
  A: {
    active: 'bg-d-legendary-dim text-d-legendary border-d-legendary-line',
    inactive: 'bg-transparent text-d-text-muted border-d-hairline',
  },
  B: {
    active: 'bg-d-legendary-dim/60 text-d-legendary/80 border-d-legendary-line/60',
    inactive: 'bg-transparent text-d-text-muted border-d-hairline',
  },
  C: {
    active: 'bg-white/5 text-d-text-sec border-white/15',
    inactive: 'bg-transparent text-d-text-muted border-d-hairline',
  },
  D: {
    active: 'bg-white/5 text-d-text-muted border-white/10',
    inactive: 'bg-transparent text-d-text-dim border-d-hairline',
  },
  F: {
    active: 'bg-d-shard-dim text-d-shard border-d-shard-line',
    inactive: 'bg-transparent text-d-text-muted border-d-hairline',
  },
};

export function TierChip({
  tier,
  active = true,
  onClick,
  title,
  compact = false,
  disabled = false,
}: {
  tier: TierLetter;
  active?: boolean;
  onClick?: () => void;
  title?: string;
  // When true, renders just the letter sized to match the existing
  // GradeChip (w-6 h-6, larger text). Use in the Drop Log / Popup
  // right-side chip slot. Default false renders "Tier X" as a small
  // inline tag suitable for explanatory contexts.
  compact?: boolean;
  // When true, the chip renders dimmed + non-clickable. Used by the Drop
  // Log filter row to keep Tier visible (no layout shift) while the type
  // filter is set to Armor.
  disabled?: boolean;
}) {
  // Defense-in-depth: if a caller hands us a value that bypassed TS (a
  // raw cache read, a hand-typed cast), bail rather than throw on the
  // map lookup. Earlier bug had `'?' as TierLetter` reach this path and
  // crash the whole dashboard render with "reading 'active' of undefined."
  const colors = TIER_COLORS[tier];
  if (!colors) return null;
  const cls = active ? colors.active : colors.inactive;
  if (onClick) {
    const baseCls =
      'text-d-11 uppercase tracking-d-wide px-2.5 py-1 border whitespace-nowrap font-medium transition-colors duration-d-fast';
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={title}
        className={`${baseCls} ${cls} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {tier}
      </button>
    );
  }
  if (compact) {
    return (
      <span
        title={title ?? `Tier ${tier}`}
        className={`inline-flex items-center justify-center w-6 h-6 text-d-12 font-medium border ${cls}`}
      >
        {tier}
      </span>
    );
  }
  const baseCls =
    'text-d-11 uppercase tracking-d-wide px-2.5 py-1 border whitespace-nowrap font-medium';
  return (
    <span title={title} className={`${baseCls} ${cls}`}>
      Tier {tier}
    </span>
  );
}
