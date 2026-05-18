// D2-style "item acquired" animation. Wraps a notification row's static
// content with three pre-render phases:
//
//   engram  (0–400ms):    rarity-colored diamond pulses at left edge
//   decrypt (400–700ms):  diamond spins, scales out, flashes; 8 particles burst
//   banner  (700–1800ms): row card slides in from -120%, flash overlay sweeps,
//                         brightness spike at the landing point
//   done   (1800ms+):     card sits as a normal row
//
// staggerIndex (0,1,2…) multiplies the start delay by 1200ms so a burst of
// drops arriving the same poll cycle queues visually rather than stacking on
// top of each other. onComplete fires when phase reaches 'done' so the
// caller can drop the notification from its "animating" set and let the
// row revert to the plain NotifRow render path.
//
// CSS keyframes (drop-slide-in / drop-flash / drop-sweep / engram-pulse /
// engram-decrypt / particles-burst) live in styles/destiny-tokens.css.

import { useEffect, useState } from 'react';

type Phase = 'engram' | 'decrypt' | 'banner' | 'done';

export interface DropNotificationProps {
  // Rarity-bound colors. rarityColor drives the engram fill + flash gradient;
  // rarityGlow is the engram's box-shadow halo.
  rarityColor: string;
  rarityGlow: string;
  // Position in the current animation queue. Used to stagger multiple
  // simultaneous drops (index × 1200ms delay before the engram appears).
  staggerIndex: number;
  // Approximate height of the row card. The engram/decrypt phases render in
  // a placeholder of this height so the surrounding layout doesn't jump when
  // the banner phase swaps in.
  rowHeight: number;
  onComplete?: () => void;
  // The static row content for the banner phase. Same content the post-animation
  // path renders, so the swap from animated → static is seamless.
  children: React.ReactNode;
}

export function DropNotification({
  rarityColor,
  rarityGlow,
  staggerIndex,
  rowHeight,
  onComplete,
  children,
}: DropNotificationProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase | 'waiting'>('waiting');

  useEffect(() => {
    const delay = staggerIndex * 1200;
    const t1 = window.setTimeout(() => setPhase('engram'), delay);
    const t2 = window.setTimeout(() => setPhase('decrypt'), delay + 400);
    const t3 = window.setTimeout(() => setPhase('banner'), delay + 700);
    const t4 = window.setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, delay + 1800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
    // onComplete is stable per drop id at the call site; not depending on it
    // keeps the timer effect from re-firing if the caller forgot useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staggerIndex]);

  if (phase === 'waiting') {
    return <div style={{ height: rowHeight }} aria-hidden />;
  }

  if (phase === 'engram' || phase === 'decrypt') {
    return (
      <div
        className="relative overflow-hidden"
        style={{ height: rowHeight }}
        aria-hidden
      >
        <div
          className="absolute"
          style={{ left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 3 }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              background: rarityColor,
              clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
              boxShadow: `0 0 20px ${rarityGlow}`,
              animation:
                phase === 'decrypt'
                  ? 'engram-decrypt 0.4s ease-in forwards'
                  : 'engram-pulse 0.5s ease-in-out infinite',
            }}
          />
        </div>
        {phase === 'decrypt' && (
          <div
            className="absolute"
            style={{ left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}
          >
            {Array.from({ length: 8 }, (_, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  width: 3,
                  height: 3,
                  background: rarityColor,
                  borderRadius: '50%',
                  left: 10,
                  top: 10,
                  opacity: 0,
                  animation: `particles-burst 0.5s ${i * 0.03}s ease-out forwards`,
                  transform: `rotate(${i * 45}deg) translateX(${8 + i * 3}px)`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // banner + done: slide-in card with flash overlay + light sweep. The outer
  // wrapper clips overflow so the translateX(-120%) start position stays
  // inside the panel — without overflow:hidden the row visually flies off
  // past the panel's left edge. The inner div carries the animation so the
  // transform is contained to its slot, and the flash/sweep overlays are
  // pinned to the inner card bounds.
  return (
    <div className="relative overflow-hidden">
      <div
        className="relative"
        style={{
          animation:
            phase === 'banner' ? 'drop-slide-in 1.1s ease-out forwards' : 'none',
        }}
      >
        {phase === 'banner' && (
          <>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                zIndex: 2,
                background: `linear-gradient(90deg, ${rarityColor}, transparent)`,
                animation: 'drop-flash 1.1s ease-out forwards',
              }}
              aria-hidden
            />
            <div
              className="absolute pointer-events-none"
              style={{
                top: 0,
                width: '40%',
                height: '100%',
                zIndex: 2,
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
                animation: 'drop-sweep 1.1s ease-out forwards',
              }}
              aria-hidden
            />
          </>
        )}
        {children}
      </div>
    </div>
  );
}
