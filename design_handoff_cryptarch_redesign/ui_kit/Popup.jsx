// Popup — 400×600 Chrome extension popup. Reimagined as D2's
// notification feed: character strip, item-acquired cards, lock actions.

function Popup({ drops, onOpenDashboard }) {
  const [now, setNow] = useState(Date.now());
  const [autoLock, setAutoLock] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const lastPoll = drops.length
    ? `${Math.floor((now - drops[0].timestamp) / 60000)}m ago`
    : 'never';

  // Show god rolls / exotics / keeps first
  const feed = drops
    .filter(d => d.grade === 'god' || d.grade === 'exotic' || d.grade === 'keep')
    .slice(0, 6);

  return (
    <div style={{
      width: 400, height: 600, background: C.bgDeep, color: C.text,
      display: 'flex', flexDirection: 'column', fontFamily: 'inherit',
      fontSize: 13, border: `1px solid ${C.hairline}`, overflow: 'hidden',
      position: 'relative',
    }}>
      <SacredBG opacity={0.7} />

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${C.hairline}`,
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="../../assets/icon-48.png" alt="" width="20" height="20"
            style={{ border: `1px solid ${C.goldLine}` }} />
          <span style={{ fontSize: 13, ...S.light, ...S.upperH }}>Cryptarch</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: C.textMuted, ...S.upper }}>
          <span style={{ width: 5, height: 5, background: C.keep, borderRadius: 0 }} />
          RahoolEnjoyer
        </div>
      </div>

      {/* ── Character strip with emblem ── */}
      <div style={{
        padding: '0', borderBottom: `1px solid ${C.hairline}`,
        position: 'relative', zIndex: 1, overflow: 'hidden',
      }}>
        {/* Emblem background placeholder — in production this would be the
            player's equipped emblem image from Bungie CDN */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, #2a3040 0%, #1a1e28 50%, #1c2030 100%)',
          opacity: 0.6,
        }}>
          {/* Diamond pattern overlay to suggest emblem texture */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.15,
            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.03) 8px, rgba(255,255,255,0.03) 9px)`,
          }} />
        </div>
        <div style={{
          position: 'relative', padding: '10px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Emblem icon placeholder (shield shape) */}
            <div style={{
              width: 32, height: 32, border: `1px solid rgba(255,255,255,0.20)`,
              background: 'linear-gradient(135deg, #3a4050, #222830)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: C.textMuted,
            }}>
              <img src="../../assets/icons/general/destiny.svg" alt="" 
                style={{ width: 18, height: 18, opacity: 0.5, filter: 'invert(1)' }} />
            </div>
            <div>
              <div style={{ fontSize: 8, ...S.upper, color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Active Guardian</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: C.text, ...S.light }}>Hunter</span>
                <span style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.15)' }} />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>⚡ 2030</span>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, ...S.upper, color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Last Sweep</div>
            <div style={{ fontSize: 11, color: C.gold, ...S.med }}>{lastPoll}</div>
          </div>
        </div>
      </div>

      {/* ── Notification feed ── */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative', zIndex: 1 }}>
        <div style={{ padding: '10px 16px 6px' }}>
          <SectionHead>Recent Drops</SectionHead>
        </div>
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {feed.length === 0 ? (
            <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', padding: '40px 0', ...S.upper }}>
              No notable drops yet
            </div>
          ) : feed.map(d => (
            <NotifRow key={d.id} drop={d} now={now} />
          ))}
        </div>
      </div>

      {/* ── Auto-lock row ── */}
      <div style={{
        padding: '10px 16px', borderTop: `1px solid ${C.hairline}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 1,
      }}>
        <span style={{ fontSize: 9, color: C.textSec, ...S.upper }}>Auto-Lock Matches</span>
        <Toggle on={autoLock} onToggle={() => setAutoLock(v => !v)} />
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: '10px 16px 14px', borderTop: `1px solid ${C.hairline}`,
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
        position: 'relative', zIndex: 1,
      }}>
        <BracketBtn onClick={onOpenDashboard} style={{ width: '100%' }}>
          Open Dashboard
        </BracketBtn>
        <span style={{ fontSize: 8, color: C.textDim, ...S.upper }}>
          ☕ Buy Me A Coffee
        </span>
      </div>
    </div>
  );
}

/* ── Notification row — looks like a D2 "item acquired" card ── */
function NotifRow({ drop, now }) {
  const [h, setH] = useState(false);
  const isGod = drop.grade === 'god';
  const isExotic = drop.isExotic;
  const isLegendary = !isExotic && drop.type === 'weapon';

  // Left border accent based on rarity
  const accent = isExotic ? C.exotic : isLegendary ? C.legendaryBright : C.keep;
  const accentDim = isExotic ? C.exoticDim : isLegendary ? C.legendaryDim : C.keepDim;

  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        background: h ? C.bgHover : C.bgPanel,
        borderLeft: `2px solid ${accent}`,
        backgroundImage: `linear-gradient(90deg, ${accentDim} 0%, transparent 40%)`,
        transition: 'background 100ms ease', position: 'relative',
      }}>
      {isGod && <GodShimmer />}
      <WeaponIcon drop={drop} size={38} />
      <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <div style={{
          fontSize: 11, color: isExotic ? C.exotic : isLegendary ? C.legendaryBright : C.text,
          ...S.med, ...S.upper, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textShadow: isGod ? `0 0 8px rgba(157,113,199,0.3)` : 'none',
        }}>{drop.name}</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 3,
        }}>
          <ElementPip sub={drop.sub} />
          <span style={{ fontSize: 9, color: C.textMuted, ...S.upper, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {drop.sub}
          </span>
        </div>
      </div>
      {drop.perks?.length > 0 && (
        <div style={{ display: 'flex', gap: 2, position: 'relative', zIndex: 1 }}>
          {drop.perks.slice(0, 4).map((p, i) => <PerkIcon key={i} perk={p} size={20} />)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, position: 'relative', zIndex: 1 }}>
        <GradeBadge grade={drop.grade} />
        <TimeAgo ms={now - drop.timestamp} />
      </div>
    </div>
  );
}

Object.assign(window, { Popup });
