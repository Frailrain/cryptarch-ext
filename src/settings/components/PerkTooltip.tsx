// Lightweight hover tooltip for perk icons. Native browser title attributes
// have a built-in delay of ~500ms-1s before showing — too slow for scanning
// a row of icons. This shows after a configurable delay (default 150ms),
// hides instantly on mouseleave, and positions itself centered above the
// wrapped element.
//
// Trade-off vs native title: this won't show outside the viewport (positioned
// above), and won't appear when icons are touched on mobile (no hover concept).
// Both acceptable for the dashboard / popup use cases.

import { useEffect, useRef, useState, type ReactNode } from 'react';

const DEFAULT_DELAY_MS = 150;

export function PerkTooltip({
  text,
  delayMs = DEFAULT_DELAY_MS,
  children,
}: {
  text: string;
  delayMs?: number;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!text) return <>{children}</>;

  const onEnter = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisible(true), delayMs);
  };
  const onLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1 text-[11px] leading-tight bg-bg-card border border-bg-border text-text-primary rounded whitespace-nowrap pointer-events-none z-50"
        >
          {text}
        </span>
      )}
    </span>
  );
}
