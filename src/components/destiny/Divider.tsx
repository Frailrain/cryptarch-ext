// Hairline divider with a centered rotated-square mark. Two variants:
// gold (filled square) for emphatic section breaks, dim (hairline-bordered
// hollow square) for subtle ones.

interface DividerProps {
  gold?: boolean;
  filled?: boolean;
  className?: string;
}

export function Divider({ gold = false, filled = false, className = '' }: DividerProps): JSX.Element {
  const borderColor = gold ? 'border-d-gold-line' : 'border-d-hairline';
  const fillClass = filled
    ? gold
      ? 'bg-d-gold border-d-gold'
      : 'bg-d-hairline'
    : 'bg-transparent';
  return (
    <div className={`flex items-center gap-3 w-full ${className}`}>
      <span className="flex-1 h-px bg-d-hairline" aria-hidden />
      <span className={`w-[5px] h-[5px] rotate-45 border ${borderColor} ${fillClass}`} aria-hidden />
      <span className="flex-1 h-px bg-d-hairline" aria-hidden />
    </div>
  );
}
