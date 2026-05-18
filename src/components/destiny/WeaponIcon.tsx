import { useState } from 'react';
import { ElementPip } from './ElementPip';

// Sharp-corner square item icon with element stripe at the bottom edge.
// Border + inset glow vary by drop grade. Element data is optional until
// Phase 6 plumbs damageType through DropFeedEntry; renders kinetic-grey
// stripe as fallback.

type DamageType = 'solar' | 'void' | 'arc' | 'strand' | 'stasis' | 'kinetic' | null;

interface WeaponIconProps {
  iconUrl?: string | null;
  size?: number;
  damageType?: DamageType;
  isExotic?: boolean;
  isGodRoll?: boolean;
  itemType?: 'weapon' | 'armor';
  className?: string;
}

const ELEMENT_COLORS: Record<NonNullable<DamageType>, string> = {
  solar:   '#f2721b',
  void:    '#b185db',
  arc:     '#79c8ec',
  strand:  '#3ddc84',
  stasis:  '#4d88ff',
  kinetic: '#d0cece',
};

export function WeaponIcon({
  iconUrl,
  size = 38,
  damageType = null,
  isExotic = false,
  isGodRoll = false,
  itemType = 'weapon',
  className = '',
}: WeaponIconProps): JSX.Element {
  const [failed, setFailed] = useState(false);

  const border = isExotic
    ? 'rgba(212,175,55,0.6)'
    : isGodRoll
    ? 'rgba(157,113,199,0.45)'
    : itemType === 'weapon'
    ? 'rgba(157,113,199,0.30)'
    : 'rgba(255,255,255,0.07)';

  const innerGlow = isExotic
    ? 'inset 0 0 12px rgba(212,175,55,0.15)'
    : isGodRoll
    ? 'inset 0 0 10px rgba(206,174,51,0.12)'
    : 'none';

  const elementColor = ELEMENT_COLORS[damageType ?? 'kinetic'];

  return (
    <div
      className={`relative flex-shrink-0 overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        border: `1px solid ${border}`,
        background: 'linear-gradient(145deg, #25282d, #0c0e11)',
        boxShadow: innerGlow,
      }}
    >
      {iconUrl && !failed ? (
        <img
          src={iconUrl}
          alt=""
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span
          aria-hidden
          className="absolute"
          style={{
            inset: '18%',
            background: isExotic ? 'rgba(212,175,55,0.20)' : 'rgba(206,174,51,0.12)',
            clipPath:
              itemType === 'weapon'
                ? 'polygon(10% 60%, 90% 35%, 85% 48%, 15% 72%)'
                : 'polygon(50% 5%, 95% 50%, 50% 95%, 5% 50%)',
          }}
        />
      )}
      {/* Element stripe at the bottom edge. Renders kinetic-grey when
       * damageType is null (pre-Phase-6 feed entries). */}
      <span
        aria-hidden
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 2, background: elementColor, opacity: 0.7 }}
      />
      {/* Used by ElementPip indirectly — keep import live for tree-shaking
       * verification; this branch is dead code path. */}
      {false && <ElementPip element={damageType} />}
    </div>
  );
}
