// Page/section headline — light weight, uppercase, hero tracking. Sizes
// match the design handoff scale; "lg" is the dashboard page headline,
// "md" the section start-of-frame, "sm" the popup-tier label.

type HeadlineSize = 'sm' | 'md' | 'lg';

interface HeadlineProps {
  children: React.ReactNode;
  size?: HeadlineSize;
  className?: string;
}

const SIZE_CLASSES: Record<HeadlineSize, string> = {
  sm: 'text-d-14 tracking-d-headline',
  md: 'text-d-18 tracking-d-widest',
  lg: 'text-[28px] leading-tight tracking-d-hero',
};

export function Headline({ children, size = 'lg', className = '' }: HeadlineProps): JSX.Element {
  return (
    <div className={`font-light uppercase text-d-text leading-tight ${SIZE_CLASSES[size]} ${className}`}>
      {children}
    </div>
  );
}
