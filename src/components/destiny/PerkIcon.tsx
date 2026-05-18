import { useState } from 'react';

// Circular perk icon — three states. tagged = wishlist-matched (gold ring +
// glow), rolled = actual perk on this drop (white ring), neutral = unrolled
// alternative (dim, low opacity). Renders Bungie CDN URLs; falls back to a
// dark radial circle if the image fails to load.

interface PerkIconProps {
  iconUrl?: string | null;
  size?: number;
  tagged?: boolean;
  rolled?: boolean;
  title?: string;
  className?: string;
}

export function PerkIcon({
  iconUrl,
  size = 22,
  tagged = false,
  rolled = false,
  title,
  className = '',
}: PerkIconProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  const dimmed = !rolled && !tagged;
  const ringWidth = tagged ? 2 : 1;
  const ringColor = tagged
    ? '#ceae33'
    : rolled
    ? 'rgba(255,255,255,0.18)'
    : 'rgba(255,255,255,0.06)';
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center flex-shrink-0 rounded-full overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        border: `${ringWidth}px solid ${ringColor}`,
        background: rolled ? 'rgba(206,174,51,0.12)' : '#0c0e11',
        opacity: dimmed ? 0.25 : 1,
        boxShadow: tagged ? '0 0 6px rgba(206,174,51,0.30)' : 'none',
      }}
    >
      {iconUrl && !failed ? (
        <img
          src={iconUrl}
          alt=""
          onError={() => setFailed(true)}
          style={{
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: size * 0.62,
            height: size * 0.62,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #4a4136, #0c0e11)',
          }}
        />
      )}
    </span>
  );
}
