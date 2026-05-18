// Small uppercase label with a trailing hairline that fills remaining row
// width. Used between content sections — e.g., "RECENT DROPS", "DROP LOG".

interface SectionHeadProps {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function SectionHead({ children, right, className = '' }: SectionHeadProps): JSX.Element {
  return (
    <div
      className={`flex items-center gap-3 text-d-13 text-d-text-muted uppercase tracking-d-widest ${className}`}
    >
      <span>{children}</span>
      <span className="flex-1 h-px bg-d-hairline" aria-hidden />
      {right}
    </div>
  );
}
