// Small rotated-square element pip — used in popup notif rows next to the
// weapon subtitle. Element data flows from DropFeedEntry.damageType once
// Phase 6 lands; until then callers pass `null` and the pip falls back to
// kinetic grey.

type Element = 'solar' | 'void' | 'arc' | 'strand' | 'stasis' | 'kinetic' | null;

interface ElementPipProps {
  element: Element;
  size?: number;
  className?: string;
}

const COLORS: Record<NonNullable<Element>, string> = {
  solar:   '#f2721b',
  void:    '#b185db',
  arc:     '#79c8ec',
  strand:  '#3ddc84',
  stasis:  '#4d88ff',
  kinetic: '#d0cece',
};

export function ElementPip({ element, size = 6, className = '' }: ElementPipProps): JSX.Element {
  const color = COLORS[element ?? 'kinetic'];
  return (
    <span
      aria-hidden
      className={`inline-block rotate-45 flex-shrink-0 ${className}`}
      style={{ width: size, height: size, background: color, opacity: 0.9 }}
    />
  );
}
