// Lightweight hover tooltip for perk icons. Native browser title attributes
// have a built-in delay of ~500ms-1s before showing — too slow for scanning
// a row of icons. This shows after a configurable delay (default 150ms),
// hides instantly on mouseleave, and auto-flips placement (top vs bottom)
// based on available viewport space at hover time.
//
// Auto-placement matters in two contexts:
//   - Popup top row: top-row icons sit right under the popup header. A
//     fixed-top tooltip pops out of the viewport entirely.
//   - Expanded Drop Detail view: cross-row tooltips need to escape the
//     row's flex container; auto-placement flips to "below" if the icon
//     is too close to the top.

import { useEffect, useRef, useState, type ReactNode } from 'react';

const DEFAULT_DELAY_MS = 150;
// Approximate tooltip + spacing height. Used to decide whether the icon has
// enough room above to render the default top placement; if not, flip to
// bottom. Doesn't need to be exact — a generous estimate just biases the
// flip toward "below" near the viewport top, which is the common case.
const ESTIMATED_TOOLTIP_HEIGHT = 32;

type Placement = 'top' | 'bottom';

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
  const [placement, setPlacement] = useState<Placement>('top');
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!text) return <>{children}</>;

  const onEnter = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      // Decide placement at show-time, not at mount, so the result reflects
      // the icon's current viewport position (handles scrolled containers,
      // popup vs dashboard, etc.).
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect && rect.top < ESTIMATED_TOOLTIP_HEIGHT) {
        setPlacement('bottom');
      } else {
        setPlacement('top');
      }
      setVisible(true);
    }, delayMs);
  };
  const onLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  const positionClass =
    placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1';

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`absolute left-1/2 -translate-x-1/2 ${positionClass} px-2 py-1 text-[11px] leading-tight bg-bg-card border border-bg-border text-text-primary rounded whitespace-nowrap pointer-events-none z-50`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
