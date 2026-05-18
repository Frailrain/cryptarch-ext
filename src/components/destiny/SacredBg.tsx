// Brief #23 — Sacred-geometry atmospheric background layer.
//
// The drift uses `transform: translate3d(...)` on an inner layer rather than
// animating `background-position` because browsers step bg-position to
// integer pixels at slow speeds, producing a stuttery crawl. Transform
// animations are GPU-composited and interpolate at sub-pixel precision.
//
// To make sure the browser actually promotes the layer to its own compositor
// surface (and doesn't re-rasterize the SVG tile every frame), we apply:
//   - will-change: transform   — explicit hint
//   - translateZ(0)            — forces 3D context = new compositor layer
//   - backfaceVisibility:hidden — secondary GPU promotion signal
//   - isolation:isolate        — prevents stacking-context merges
//
// The inner layer is oversized by one tile-size (480px) on each axis so the
// translate sweeps a full tile without ever exposing the layer edge. Since
// the SVG tile repeats, translating exactly one tile-width returns to a
// visually identical state, giving a seamless infinite loop.

import sacredGeometryUrl from '@/assets/destiny/sacred-geometry.svg';

interface SacredBgProps {
  opacity?: number;
  className?: string;
}

export function SacredBg({ opacity = 0.6, className = '' }: SacredBgProps): JSX.Element {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ opacity, zIndex: 0, isolation: 'isolate' }}
    >
      <div
        className="absolute top-0 left-0 animate-sacred-drift"
        style={{
          width: 'calc(100% + 480px)',
          height: 'calc(100% + 480px)',
          backgroundImage: `url(${sacredGeometryUrl})`,
          backgroundRepeat: 'repeat',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          // translateZ(0) on the initial state is a no-op visually but
          // forces the element onto its own compositor layer. The
          // animation keyframes then animate the full transform.
          transform: 'translate3d(0, 0, 0)',
        }}
      />
    </div>
  );
}
