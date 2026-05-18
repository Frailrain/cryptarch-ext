// Dashboard — full reimagining as a D2 menu screen.
// Drop Log with weapon-inspection rows, Armor rules, Settings.

const TIER_ORDER = ['S','A','B','C','D','F'];

function Dashboard({ drops, initialTab = 'drops', onLock }) {
  const [tab, setTab] = useState(initialTab);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      color: C.text, minHeight: '100%', fontFamily: 'inherit', fontSize: 13,
      position: 'relative', background: C.bgBase,
    }}>
      <SacredBG opacity={0.6} />

      {/* ── Top bar ── */}
      <header style={{ borderBottom: `1px solid ${C.hairline}`, position: 'relative', zIndex: 1 }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '16px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="../../assets/icon-48.png" width="28" height="28"
              style={{ border: `1px solid ${C.goldLine}` }} alt="" />
            <div>
              <div style={{ fontSize: 15, ...S.light, ...S.upperH }}>Cryptarch</div>
              <div style={{ fontSize: 8, color: C.textMuted, ...S.upper, marginTop: 2 }}>Loot Appraiser · v0.6.2</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: C.textMuted, ...S.upper }}>
              <span style={{ width: 5, height: 5, background: C.keep }} />
              RahoolEnjoyer
            </div>
            <Btn small>Sign Out</Btn>
          </div>
        </div>
      </header>

      {/* ── Tab nav (D2 destination-selector style) ── */}
      <nav style={{ borderBottom: `1px solid ${C.hairline}`, position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 28px', display: 'flex', gap: 0 }}>
          {[['drops','Drops'],['armor','Armor'],['weapons','Settings']].map(([k, label]) => {
            const active = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)}
                style={{
                  padding: '12px 22px', fontFamily: 'inherit', fontSize: 10,
                  background: 'transparent', border: 0,
                  ...S.med, ...S.upper,
                  color: active ? C.gold : C.textMuted,
                  borderBottom: active ? `2px solid ${C.gold}` : '2px solid transparent',
                  marginBottom: -1,
                  textShadow: active ? '0 0 10px rgba(206,174,51,0.5)' : 'none',
                  transition: 'all 100ms ease',
                }}>{label}</button>
            );
          })}
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 28, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {tab === 'drops' && <DropLog drops={drops} now={now} onLock={onLock} />}
        {tab === 'armor' && <ArmorTab />}
        {tab === 'weapons' && <SettingsTab />}

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <span style={{ fontSize: 8, color: C.textDim, ...S.upper }}>
            Cryptarch · Chrome Edition · v0.6.2 · ☕ Buy Me A Coffee
          </span>
        </div>
      </main>
    </div>
  );
}

/* ════════════ DROP LOG ════════════ */
function DropLog({ drops, now, onLock }) {
  const [typeF, setTypeF] = useState('all');
  const [tiers, setTiers] = useState(new Set(TIER_ORDER));
  const [showExotic, setShowExotic] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const toggleTier = (t) => { const n = new Set(tiers); n.has(t) ? n.delete(t) : n.add(t); setTiers(n); };

  const visible = drops.filter(d => {
    if (typeF !== 'all' && d.type !== typeF) return false;
    if (d.isExotic) return showExotic;
    if (d.type === 'weapon' && d.tier && !tiers.has(d.tier)) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header + filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <Headline>Drop Log</Headline>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <FilterRow label="Type" options={[['all','All'],['weapon','Weapons'],['armor','Armor']]} value={typeF} onChange={setTypeF} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 9, color: C.textMuted, ...S.upper, marginRight: 4 }}>Tier</span>
            {TIER_ORDER.map(t => <Chip key={t} active={tiers.has(t)} onClick={() => toggleTier(t)}>{t}</Chip>)}
          </div>
          <Chip active={showExotic} color="exotic" onClick={() => setShowExotic(v => !v)}>Exotic</Chip>
        </div>
      </div>

      {/* Drop list */}
      <div style={{ background: C.bgPanel, border: `1px solid ${C.hairline}`, position: 'relative' }}>
        <Ticks size={12} />
        {visible.length === 0 ? (
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', padding: '48px 0', ...S.upper }}>
            No drops match filters
          </div>
        ) : visible.map((d, i) => (
          <DropRow key={d.id} drop={d} now={now}
            expanded={expandedId === d.id}
            onToggle={() => d.pool && setExpandedId(p => p === d.id ? null : d.id)}
            onLock={onLock}
            isLast={i === visible.length - 1} />
        ))}
      </div>
    </div>
  );
}

function FilterRow({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 9, color: C.textMuted, ...S.upper, marginRight: 4 }}>{label}</span>
      {options.map(([k, n]) => <Chip key={k} active={value === k} onClick={() => onChange(k)}>{n}</Chip>)}
    </div>
  );
}

/* ── Weapon drop row ── */
function DropRow({ drop, now, expanded, onToggle, onLock, isLast }) {
  const [h, setH] = useState(false);
  const isGod = drop.grade === 'god';
  const isExotic = drop.isExotic;
  const isShard = drop.grade === 'shard';
  const isLegendary = !isExotic && drop.type === 'weapon';
  const expandable = !!drop.pool;
  const elem = elementColor(drop.sub);

  // Row tint: god=gold, shard=darkened, legendary=subtle purple
  const bg = h ? C.bgHover 
    : isShard ? 'rgba(0,0,0,0.15)'
    : isGod ? 'rgba(82,47,101,0.08)' 
    : isExotic ? 'rgba(212,175,55,0.03)' 
    : 'transparent';

  return (
    <div style={{ borderBottom: isLast ? 0 : `1px solid ${C.hairline}` }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        background: bg, transition: 'background 100ms ease', position: 'relative',
      }}
        onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        onClick={expandable ? onToggle : undefined}>
        {isGod && <GodShimmer />}

        <WeaponIcon drop={drop} size={44} />

        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 12, ...S.med, ...S.upper,
              color: isExotic ? C.exotic : isLegendary ? C.legendaryBright : C.text,
              textShadow: isGod ? '0 0 8px rgba(157,113,199,0.3)' : 'none',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              opacity: isShard ? 0.5 : 1,
            }}>{drop.name}</span>
            {drop.tier && <span style={{
              fontSize: 8, color: C.textMuted, ...S.upper,
              padding: '1px 5px', border: `1px solid ${C.hairline}`,
            }}>{drop.tier}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <ElementPip sub={drop.sub} />
            <span style={{ fontSize: 9, color: C.textMuted, ...S.upper }}>{drop.sub}</span>
          </div>
          {drop.sources?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
              {drop.sources.map(s => (
                <span key={s} style={{
                  fontSize: 8, padding: '1px 6px', color: C.gold, ...S.upper,
                  border: `1px solid ${C.goldLine}`, background: C.goldDim,
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Perk row */}
        {drop.perks?.length > 0 && (
          <div style={{ display: 'flex', gap: 3, position: 'relative', zIndex: 1 }}>
            {drop.perks.map((p, i) => <PerkIcon key={i} perk={p} size={26} />)}
          </div>
        )}

        <GradeBadge grade={drop.grade} />
        <LockState locked={drop.locked} grade={drop.grade} onLock={() => onLock?.(drop.id)} />
        <TimeAgo ms={now - drop.timestamp} />

        {expandable && (
          <span style={{ fontSize: 12, color: C.textMuted, width: 12, textAlign: 'center', fontWeight: 300 }}>
            {expanded ? '⌄' : '›'}
          </span>
        )}
      </div>

      {/* Expanded perk pool */}
      {expanded && expandable && (
        <div style={{
          padding: '14px 16px 16px 76px', borderTop: `1px solid ${C.hairline2}`,
          background: 'rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{ fontSize: 9, color: C.textMuted, ...S.upperW }}>Perk Pool</div>
          <div style={{ display: 'flex', gap: 20 }}>
            {drop.pool.map((col, ci) => (
              <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 8, color: C.textDim, ...S.upper, marginBottom: 2 }}>Col {ci + 1}</div>
                {col.map((plug, pi) => {
                  const rolled = drop.perks[ci]?.icon === plug.icon;
                  return <PerkIcon key={pi} perk={{ icon: plug.icon, rolled, tagged: plug.tagged }} size={24} />;
                })}
              </div>
            ))}
          </div>
          {drop.sources?.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.hairline2}`, paddingTop: 10 }}>
              {drop.sources.map(s => (
                <div key={s} style={{ fontSize: 9, color: C.textMuted }}>
                  <span style={{ color: C.gold }}>{s}</span>
                  {s === 'Aegis Endgame' && drop.tier && <span style={{ marginLeft: 8, fontSize: 8, ...S.upper }}>Tier {drop.tier}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════ ARMOR TAB ════════════ */
function ArmorTab() {
  const [rules, setRules] = useState(SAMPLE_RULES);
  const [autoMatch, setAutoMatch] = useState(true);
  const summary = (r) => [r.klass, r.sets.length ? r.sets.join('/') : null, r.archetypes.length ? r.archetypes.join('/') : null, `T${r.minTier}+`].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <Headline>Armor Rules</Headline>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, color: C.textMuted, ...S.upper }}>Auto-Lock</span>
            <Toggle on={autoMatch} onToggle={() => setAutoMatch(v => !v)} />
          </div>
          <BracketBtn small>+ New Rule</BracketBtn>
        </div>
      </div>

      <Panel ticks>
        {rules.map((r, i) => (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0',
            borderBottom: i < rules.length - 1 ? `1px solid ${C.hairline}` : 0,
            opacity: r.enabled ? 1 : 0.35, transition: 'opacity 150ms ease',
          }}>
            <Toggle on={r.enabled} onToggle={() => setRules(rules.map(x => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, ...S.med, ...S.upper, color: C.text }}>{r.name || summary(r)}</div>
              {r.name && <div style={{ fontSize: 9, color: C.textMuted, ...S.upper, marginTop: 3 }}>{summary(r)}</div>}
            </div>
            <Btn small>Edit</Btn>
            <Btn variant="danger" small onClick={() => setRules(rules.filter(x => x.id !== r.id))}>Delete</Btn>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ════════════ SETTINGS TAB ════════════ */
function SettingsTab() {
  const [minTier, setMinTier] = useState('A');
  const [ppc, setPpc] = useState(2);
  const [voltron, setVoltron] = useState(true);
  const [autoLock, setAutoLock] = useState(true);
  const [notif, setNotif] = useState('all');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Headline>Settings</Headline>

      {/* Wishlist coverage */}
      <Panel accent="gold" ticks>
        <SectionHead>Wishlist Coverage</SectionHead>
        <div style={{ marginTop: 12, fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
          Pick the tier threshold and perk strictness for Aegis-rated weapons.
        </div>

        <SettingRow label="Min Tier">
          <div style={{ display: 'flex', gap: 3 }}>
            {['S','A','B','C','D','F'].map(t => <Chip key={t} active={minTier === t} onClick={() => setMinTier(t)}>{t}</Chip>)}
          </div>
        </SettingRow>

        <SettingRow label="Perks Per Column">
          <div style={{ display: 'flex', gap: 3 }}>
            {[0,1,2,3].map(n => <Chip key={n} active={ppc === n} onClick={() => setPpc(n)}>{String(n)}</Chip>)}
          </div>
        </SettingRow>

        <SettingRow label="Voltron Confirmation" sub="Show thumbs-up when community keepers also flag the roll">
          <Toggle on={voltron} onToggle={() => setVoltron(v => !v)} />
        </SettingRow>
      </Panel>

      {/* Notifications */}
      <Panel>
        <SectionHead>Notifications</SectionHead>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['gods', 'God rolls only'],
            ['all', 'All good rolls (god + keep)'],
            ['matched', 'Anything matching a rule'],
          ].map(([k, label]) => {
            const active = notif === k;
            return (
              <button key={k} onClick={() => setNotif(k)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  background: active ? C.goldDim : 'transparent',
                  borderLeft: `2px solid ${active ? C.gold : 'transparent'}`,
                  border: 0, borderLeft: `2px solid ${active ? C.gold : 'transparent'}`,
                  textAlign: 'left', fontFamily: 'inherit',
                  transition: 'all 100ms ease',
                }}>
                <span style={{
                  width: 10, height: 10, border: `1px solid ${active ? C.gold : C.hairline}`,
                  background: active ? C.gold : 'transparent', flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, color: active ? C.text : C.textSec }}>{label}</span>
              </button>
            );
          })}
        </div>

        <SettingRow label="Auto-Lock Matches" sub="When off, notifications show a Lock button instead">
          <Toggle on={autoLock} onToggle={() => setAutoLock(v => !v)} />
        </SettingRow>
      </Panel>

      {/* Account */}
      <Panel>
        <SectionHead>Bungie Account</SectionHead>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, color: C.text }}>RahoolEnjoyer#1234</div>
            <div style={{ fontSize: 9, color: C.textMuted, ...S.upper, marginTop: 3 }}>Steam · Connected 14 days ago</div>
          </div>
          <Btn variant="danger" small>Disconnect</Btn>
        </div>
      </Panel>

      <Divider gold />
    </div>
  );
}

function SettingRow({ label, sub, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderTop: `1px solid ${C.hairline}`, marginTop: 8,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, ...S.upper, color: C.text }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

Object.assign(window, { Dashboard });
