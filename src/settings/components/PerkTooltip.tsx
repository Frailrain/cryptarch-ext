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
// Approximate tooltip height after wrapping. Multi-line tooltips run 30-60px
// at the 240px max-width; the popup's drop rows start ~100px below the popup
// top after the header + filter chips, so a generous 120px threshold flips
// any icon in the popup's top region to render below instead of above.
const ESTIMATED_TOOLTIP_HEIGHT = 120;
// Inline cap on tooltip width. Long perk descriptions (e.g. "Activating your
// grenade ability reloads this weapon from reserves") would otherwise extend
// past viewport edges with whitespace-nowrap. Wraps to multi-line at this
// width.
const TOOLTIP_MAX_WIDTH_PX = 240;
// Minimum margin between the tooltip and the viewport's left/right edges.
// Tooltip's natural left center can pull it past the edge; we clamp the
// horizontal offset post-render so the tooltip stays fully visible.
const VIEWPORT_EDGE_MARGIN = 8;

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
  // Horizontal nudge applied to the tooltip when its natural-centered
  // position would push it past a viewport edge. Positive = shift right
  // (icon near left edge), negative = shift left (near right edge).
  const [horizontalNudge, setHorizontalNudge] = useState<number>(0);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // After the tooltip mounts, measure its real width and clamp horizontal
  // position so it doesn't extend past either viewport edge. Runs once per
  // show; tooltip text is static for a given hover.
  useEffect(() => {
    if (!visible) return;
    const wrapper = wrapperRef.current;
    const tip = tooltipRef.current;
    if (!wrapper || !tip) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const tipCenterX = wrapperRect.left + wrapperRect.width / 2;
    const tipLeftEdge = tipCenterX - tipRect.width / 2;
    const tipRightEdge = tipCenterX + tipRect.width / 2;
    const viewportWidth = window.innerWidth;
    let nudge = 0;
    if (tipLeftEdge < VIEWPORT_EDGE_MARGIN) {
      nudge = VIEWPORT_EDGE_MARGIN - tipLeftEdge;
    } else if (tipRightEdge > viewportWidth - VIEWPORT_EDGE_MARGIN) {
      nudge = viewportWidth - VIEWPORT_EDGE_MARGIN - tipRightEdge;
    }
    if (nudge !== horizontalNudge) setHorizontalNudge(nudge);
  }, [visible, horizontalNudge]);

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
      setHorizontalNudge(0);
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
          ref={tooltipRef}
          role="tooltip"
          className={`absolute left-1/2 ${positionClass} px-2 py-1 text-[11px] leading-tight bg-bg-card border border-bg-border text-text-primary rounded pointer-events-none z-50`}
          style={{
            // Center on the icon, then nudge horizontally if measurement
            // showed the natural position would push past a viewport edge.
            transform: `translateX(calc(-50% + ${horizontalNudge}px))`,
            // width: max-content tells the browser "size to the content's
            // unwrapped natural width" — required because the absolute
            // positioning context is the icon-sized wrapper. Without this,
            // shrink-to-fit clamps the tooltip to ~22px and we get one
            // character per line. max-width then caps it for long
            // descriptions; whitespace + wordBreak allow the wrap inside
            // the cap.
            width: 'max-content',
            maxWidth: TOOLTIP_MAX_WIDTH_PX,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
