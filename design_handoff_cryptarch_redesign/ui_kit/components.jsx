// Cryptarch — Destiny-native component atoms. Ground-up rebuild.
// Every component reimagined to feel like D2's in-game menus.

const { useState, useEffect, useRef, useMemo } = React;

/* ─── Palette ─── */
const C = {
  void:     '#b185db', // void purple
  solar:    '#f2721b', // solar orange  
  arc:      '#79c8ec', // arc blue
  strand:   '#3ddc84', // strand green
  stasis:   '#4d88ff', // stasis blue
  kinetic:  '#d0cece', // kinetic silver
  legendary: '#522f65', // legendary purple
  legendaryBright: '#9d71c7', // legendary name text
  legendaryDim: 'rgba(82,47,101,0.18)', // legendary row tint
  legendaryLine: 'rgba(157,113,199,0.45)', // legendary border

  bgDeep:    '#0c0e11',
  bgBase:    '#151719',
  bgPanel:   '#1c1e22',
  bgEle:     '#25282d',
  bgHover:   '#2a2d33',
  hairline:  'rgba(255,255,255,0.07)',
  hairline2: 'rgba(255,255,255,0.035)',

  text:      '#e2e2e2',
  textSec:   '#9a9da4',
  textMuted: '#6b6e75',
  textDim:   '#3e4046',

  gold:      '#ceae33',
  goldPale:  '#e8d57a',
  goldDim:   'rgba(206,174,51,0.10)',
  goldHover: 'rgba(206,174,51,0.18)',
  goldLine:  'rgba(206,174,51,0.45)',
  goldBright:'#f5d96e',

  exotic:    '#d4af37',
  exoticDim: 'rgba(212,175,55,0.12)',

  keep:      '#5a9e6f',
  keepDim:   'rgba(90,158,111,0.12)',
  shard:     '#c23a3a',
  shardDim:  'rgba(194,58,58,0.12)',
};

/* Element color from subtitle */
function elementColor(sub) {
  if (!sub) return C.kinetic;
  const s = sub.toLowerCase();
  if (s.includes('solar')) return C.solar;
  if (s.includes('void')) return C.void;
  if (s.includes('arc')) return C.arc;
  if (s.includes('strand')) return C.strand;
  if (s.includes('stasis')) return C.stasis;
  return C.kinetic;
}

/* ─── Styles ─── */
const S = {
  upper:    { textTransform: 'uppercase', letterSpacing: '0.12em' },
  upperW:   { textTransform: 'uppercase', letterSpacing: '0.18em' },
  upperH:   { textTransform: 'uppercase', letterSpacing: '0.25em' },
  light:    { fontWeight: 300 },
  med:      { fontWeight: 500 },
};

/* ─── Sacred geometry background SVG (file reference) ─── */
const SACRED_BG = `url("../../assets/sacred-geometry.svg")`;

/* ─── SacredBG layer ─── */
function SacredBG({ opacity = 1 }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
      backgroundImage: SACRED_BG,
      backgroundRepeat: 'repeat',
      opacity,
      animation: 'sacredDrift 120s linear infinite',
    }} />
  );
}

/* ─── Corner ticks ─── */
function Ticks({ color, size = 10 }) {
  const c = color || C.goldLine;
  const t = { position: 'absolute', background: c, pointerEvents: 'none' };
  return (<>
    <span style={{ ...t, width: size, height: 1, top: 0, left: 0 }} />
    <span style={{ ...t, width: 1, height: size, top: 0, left: 0 }} />
    <span style={{ ...t, width: size, height: 1, top: 0, right: 0 }} />
    <span style={{ ...t, width: 1, height: size, top: 0, right: 0 }} />
    <span style={{ ...t, width: size, height: 1, bottom: 0, left: 0 }} />
    <span style={{ ...t, width: 1, height: size, bottom: 0, left: 0 }} />
    <span style={{ ...t, width: size, height: 1, bottom: 0, right: 0 }} />
    <span style={{ ...t, width: 1, height: size, bottom: 0, right: 0 }} />
  </>);
}

/* ─── Diamond divider ─── */
function Divider({ gold, style }) {
  const c = gold ? C.goldLine : C.hairline;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', ...style }}>
      <span style={{ flex: 1, height: 1, background: C.hairline }} />
      <span style={{ width: 5, height: 5, transform: 'rotate(45deg)', border: `1px solid ${c}`, background: gold ? C.gold : 'transparent', flexShrink: 0 }} />
      <span style={{ flex: 1, height: 1, background: C.hairline }} />
    </div>
  );
}

/* ─── Section header ─── */
function SectionHead({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: C.textMuted, ...S.upperW }}>
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: C.hairline }} />
      {right}
    </div>
  );
}

/* ─── Headline ─── */
function Headline({ children, size = 18 }) {
  return <div style={{ fontSize: size, ...S.light, ...S.upperH, color: C.text, margin: 0, lineHeight: 1.1 }}>{children}</div>;
}

/* ─── Bracket button (▶▶ TEXT ◀◀) ─── */
function BracketBtn({ children, onClick, style, small }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: small ? '6px 14px' : '10px 24px',
        fontFamily: 'inherit', fontSize: small ? 9 : 11, ...S.med, ...S.upper,
        color: h ? C.goldPale : C.gold,
        background: h ? C.goldHover : C.goldDim,
        border: `1px solid ${h ? C.gold : C.goldLine}`,
        borderRadius: 0, transition: 'all 100ms ease', ...style,
      }}>
      <span style={{ fontSize: small ? 6 : 7, opacity: 0.7, letterSpacing: '-1px' }}>▶▶</span>
      {children}
      <span style={{ fontSize: small ? 6 : 7, opacity: 0.7, letterSpacing: '-1px' }}>◀◀</span>
    </button>
  );
}

/* ─── Ghost button ─── */
function Btn({ children, onClick, variant = 'ghost', small, style }) {
  const [h, setH] = useState(false);
  const v = {
    ghost:   { bg: 'transparent', bgH: C.bgEle, fg: C.textSec, fgH: C.text, bc: C.hairline, bcH: 'rgba(255,255,255,0.15)' },
    primary: { bg: C.goldDim, bgH: C.goldHover, fg: C.gold, fgH: C.goldPale, bc: C.goldLine, bcH: C.gold },
    danger:  { bg: 'transparent', bgH: C.shardDim, fg: '#e06060', fgH: C.shard, bc: 'rgba(194,58,58,0.4)', bcH: C.shard },
    lock:    { bg: C.goldDim, bgH: C.goldHover, fg: C.gold, fgH: C.goldBright, bc: C.goldLine, bcH: C.gold },
  }[variant];
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        padding: small ? '4px 10px' : '7px 14px', fontFamily: 'inherit',
        fontSize: small ? 9 : 10, ...S.med, ...S.upper,
        background: h ? v.bgH : v.bg, color: h ? v.fgH : v.fg,
        border: `1px solid ${h ? v.bcH : v.bc}`, borderRadius: 0,
        transition: 'all 100ms ease', ...style,
      }}>{children}</button>
  );
}

/* ─── Chip ─── */
function Chip({ children, active, onClick, color = 'gold', style }) {
  const p = {
    gold:   { fg: C.gold,   bc: C.goldLine,  fill: C.goldDim },
    exotic: { fg: C.exotic,  bc: 'rgba(212,175,55,0.45)', fill: C.exoticDim },
    keep:   { fg: C.keep,   bc: 'rgba(90,158,111,0.45)', fill: C.keepDim },
    shard:  { fg: C.shard,  bc: 'rgba(194,58,58,0.45)', fill: C.shardDim },
  }[color];
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: '3px 9px', fontSize: 9, fontFamily: 'inherit', ...S.med, ...S.upper,
        background: active ? p.fill : 'transparent',
        color: active ? p.fg : C.textMuted,
        border: `1px solid ${active ? p.bc : C.hairline}`,
        borderRadius: 0, whiteSpace: 'nowrap', transition: 'all 100ms ease', ...style,
      }}>{children}</button>
  );
}

/* ─── Angular toggle ─── */
function Toggle({ on, onToggle }) {
  return (
    <button type="button" onClick={onToggle}
      style={{
        display: 'inline-grid', gridTemplateColumns: '34px 34px', height: 22,
        border: `1px solid ${C.hairline}`, background: C.bgDeep,
        fontFamily: 'inherit', padding: 0, borderRadius: 0,
      }}>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, ...S.med, ...S.upper,
        color: on ? C.gold : C.textDim,
        background: on ? C.goldDim : 'transparent',
        borderRight: `1px solid ${C.hairline}`,
        textShadow: on ? `0 0 6px rgba(206,174,51,0.4)` : 'none',
      }}>On</span>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, ...S.med, ...S.upper,
        color: !on ? C.textSec : C.textDim,
        background: !on ? C.bgEle : 'transparent',
      }}>Off</span>
    </button>
  );
}

/* ─── Grade badge (angular slash right edge) ─── */
function GradeBadge({ grade }) {
  const p = {
    god:    { bg: 'rgba(206,174,51,0.22)', fg: C.goldBright, label: 'GOD ROLL', glow: `0 0 12px rgba(206,174,51,0.3)` },
    keep:   { bg: C.keepDim, fg: C.keep, label: 'KEEP', glow: 'none' },
    exotic: { bg: C.exoticDim, fg: '#e8c948', label: 'EXOTIC', glow: `0 0 10px rgba(212,175,55,0.25)` },
    shard:  { bg: C.shardDim, fg: '#e06060', label: 'SHARD', glow: 'none' },
  }[grade];
  if (!p) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 58, height: 22, padding: '0 8px 0 6px',
      fontSize: 8, ...S.med, letterSpacing: '0.18em', textTransform: 'uppercase',
      background: p.bg, color: p.fg, borderRadius: 0,
      clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)',
      paddingRight: 14,
      boxShadow: p.glow,
    }}>{p.label}</span>
  );
}

/* ─── Element pip (small colored diamond) ─── */
function ElementPip({ sub }) {
  const col = elementColor(sub);
  return (
    <span style={{
      width: 6, height: 6, transform: 'rotate(45deg)',
      background: col, flexShrink: 0, opacity: 0.9,
    }} />
  );
}

/* ─── Circular perk icon (D2 style) — renders real Bungie CDN perk images ─── */
function PerkIcon({ perk, size = 26 }) {
  const { icon, rolled, tagged } = perk;
  const dimmed = !rolled && !tagged;
  const ringColor = tagged ? C.gold : rolled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
  const ringWidth = tagged ? 2 : 1;
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      border: `${ringWidth}px solid ${ringColor}`,
      background: rolled ? 'rgba(206,174,51,0.12)' : C.bgDeep,
      opacity: dimmed ? 0.25 : 1, transition: 'opacity 150ms ease',
      boxShadow: tagged ? `0 0 6px rgba(206,174,51,0.3)` : 'none',
      overflow: 'hidden',
    }}>
      {icon ? (
        <img src={icon} alt="" style={{
          width: size * 0.72, height: size * 0.72, borderRadius: '50%',
          objectFit: 'cover',
        }} onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <span style={{
          width: size * 0.62, height: size * 0.62, borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, #4a4136, #0c0e11)`,
        }} />
      )}
    </span>
  );
}

/* ─── Weapon icon — renders real Bungie CDN item icons with fallback ─── */
function WeaponIcon({ drop, size = 48 }) {
  const elem = elementColor(drop.sub);
  const isExotic = drop.isExotic;
  const isLegendary = !isExotic && drop.type === 'weapon';
  const borderColor = isExotic ? 'rgba(212,175,55,0.6)'
    : drop.grade === 'god' ? C.legendaryLine
    : isLegendary ? 'rgba(157,113,199,0.30)'
    : C.hairline;
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, position: 'relative',
      border: `1px solid ${borderColor}`,
      background: `linear-gradient(145deg, ${C.bgEle}, ${C.bgDeep})`,
      boxShadow: isExotic ? `inset 0 0 12px rgba(212,175,55,0.15)` : drop.grade === 'god' ? `inset 0 0 10px rgba(206,174,51,0.12)` : 'none',
      overflow: 'hidden',
    }}>
      {drop.icon && !imgFailed ? (
        <img src={drop.icon} alt="" style={{
          width: '100%', height: '100%', objectFit: 'cover',
        }} onError={() => setImgFailed(true)} />
      ) : (
        <>
          <span style={{
            position: 'absolute', inset: '18%',
            background: isExotic ? 'rgba(212,175,55,0.20)' : `rgba(206,174,51,0.12)`,
            clipPath: drop.type === 'weapon'
              ? 'polygon(10% 60%, 90% 35%, 85% 48%, 15% 72%)'
              : 'polygon(50% 5%, 95% 50%, 50% 95%, 5% 50%)',
          }} />
          <span style={{
            position: 'absolute', top: 2, right: 3, fontSize: 7, color: C.textMuted,
            fontWeight: 500, letterSpacing: '0.05em',
          }}>1830</span>
        </>
      )}
      {/* Element stripe at bottom */}
      <span style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: elem, opacity: 0.7,
      }} />
    </div>
  );
}

/* ─── Shimmer overlay for god-roll rows ─── */
function GodShimmer() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      borderRadius: 0,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: '-100%', width: '50%', height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(206,174,51,0.06), transparent)',
        animation: 'shimmer 4s ease-in-out infinite',
      }} />
    </div>
  );
}

/* ─── Panel (card with optional top accent) ─── */
function Panel({ children, accent, ticks, style }) {
  return (
    <div style={{
      background: C.bgPanel, border: `1px solid ${C.hairline}`,
      padding: 20, position: 'relative', borderRadius: 0,
      ...(accent ? { borderTopColor: accent === 'gold' ? C.goldLine : accent === 'exotic' ? 'rgba(212,175,55,0.45)' : C.hairline } : null),
      ...style,
    }}>
      {ticks && <Ticks />}
      {children}
    </div>
  );
}

/* ─── Lock indicator ─── */
function LockState({ locked, grade, onLock }) {
  if (locked) return <span style={{ color: C.gold, fontSize: 13, textShadow: `0 0 6px rgba(206,174,51,0.4)` }} title="Locked">🔒</span>;
  const showLock = grade === 'god' || grade === 'keep' || grade === 'exotic';
  if (!showLock) return <span style={{ width: 18 }} />;
  return <Btn variant="lock" small onClick={onLock}>Lock</Btn>;
}

/* ─── Time label ─── */
function TimeAgo({ ms }) {
  const s = Math.max(0, Math.floor(ms / 1000));
  let label;
  if (s < 60) label = `${s}s`;
  else if (s < 3600) label = `${Math.floor(s / 60)}m`;
  else if (s < 86400) label = `${Math.floor(s / 3600)}h`;
  else label = `${Math.floor(s / 86400)}d`;
  return <span style={{ fontSize: 9, color: C.textMuted, ...S.upper, whiteSpace: 'nowrap' }}>{label} ago</span>;
}

Object.assign(window, {
  C, S, SACRED_BG, elementColor,
  SacredBG, Ticks, Divider, SectionHead, Headline,
  BracketBtn, Btn, Chip, Toggle,
  GradeBadge, ElementPip, PerkIcon, WeaponIcon,
  GodShimmer, Panel, LockState, TimeAgo,
});
