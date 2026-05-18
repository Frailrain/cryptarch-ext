// Brief #23 — Destiny-native popup rewrite. Surface composition:
//   1. Header bar      — extension icon + CRYPTARCH + connection dot + name
//   2. Guardian strip  — emblem placeholder + active-guardian label + last sweep
//   3. Drop feed       — RECENT DROPS section header + NotifRow stack
//   4. Auto-lock row   — label + angular Toggle
//   5. Footer          — BracketBtn "OPEN DASHBOARD" + Ko-fi link
//   6. Expired banner  — visible only when auth.state === 'expired'
//
// All data subscriptions and storage shapes carry over from v0.6. Filter
// chips (tier / type / exotic) were dropped per the redesign — the popup
// is now strictly quick-glance; filtering lives on the dashboard.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadFeed } from '@/core/storage/drop-feed';
import { isLoggedIn } from '@/core/bungie/auth';
import {
  loadActiveCharacter,
  loadAuthState,
  loadPrimaryMembership,
  type ActiveCharacter,
  type AuthState,
  type DestinyMembership,
} from '@/core/storage/tokens';
import { onKeyChanged } from '@/adapters/storage';
import { loadScoringConfig, saveScoringConfig } from '@/core/storage/scoring-config';
import { send } from '@/shared/messaging';
import {
  BracketBtn,
  Btn,
  GradeBadge,
  SacredBg,
  SectionHead,
  Toggle,
  WeaponIcon,
} from '@/components/destiny';

const CLASS_NAMES: Record<number, string> = {
  0: 'Titan',
  1: 'Hunter',
  2: 'Warlock',
};
function classLabel(classType: number | undefined): string {
  if (classType === undefined) return 'Guardian';
  return CLASS_NAMES[classType] ?? 'Guardian';
}
function bungieImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `https://www.bungie.net${path}`;
}
import type { DropFeedEntry, PendingNavigation } from '@/shared/types';

const MAX_ROWS = 10;
const PENDING_NAV_KEY = 'pendingNavigation';

type Grade = 'god' | 'keep' | 'exotic' | 'shard';

function deriveGrade(entry: DropFeedEntry): Grade | null {
  if (entry.isExotic) return 'exotic';
  const isArmor = entry.itemType === 'armor';
  if (isArmor) return entry.armorMatched === true ? 'keep' : null;
  const matched = (entry.wishlistMatches ?? []).some((m) => m.notificationOnly !== true);
  if (!matched) return 'shard';
  return entry.weaponTier === 'S' ? 'god' : 'keep';
}

function buildWeaponSubtitle(entry: DropFeedEntry): string {
  const parts: string[] = [];
  if (entry.weaponType) parts.push(entry.weaponType);
  if (entry.weaponSlot) parts.push(entry.weaponSlot);
  if (entry.damageType && entry.damageType !== 'None') parts.push(entry.damageType);
  return parts.length > 0 ? parts.join(' · ') : 'Weapon';
}

function buildArmorSubtitle(entry: DropFeedEntry): string {
  const parts: string[] = [];
  if (entry.armorClass) parts.push(entry.armorClass);
  if (entry.armorSet) parts.push(entry.armorSet);
  if (entry.armorArchetype) parts.push(entry.armorArchetype);
  if (entry.armorTertiary) parts.push(entry.armorTertiary);
  if (entry.armorTier) parts.push(`T${entry.armorTier}`);
  return parts.length > 0 ? parts.join(' · ') : 'Armor';
}

function formatRelative(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Popup(): JSX.Element {
  const [signedIn, setSignedIn] = useState<boolean>(() => isLoggedIn());
  const [authState, setAuthState] = useState<AuthState>(() => loadAuthState());
  const [reconnectPending, setReconnectPending] = useState(false);
  const [membership, setMembership] = useState<DestinyMembership | null>(
    () => loadPrimaryMembership(),
  );
  const [activeCharacter, setActiveCharacter] = useState<ActiveCharacter | null>(
    () => loadActiveCharacter(),
  );
  const [feed, setFeed] = useState<DropFeedEntry[]>(() => loadFeed());
  const [autoLock, setAutoLock] = useState<boolean>(
    () => loadScoringConfig().autoLockOnArmorMatch,
  );
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const unsubFeed = onKeyChanged<DropFeedEntry[]>('drop-feed', (v) => setFeed(v ?? []));
    const unsubTokens = onKeyChanged('auth.tokens', (v) => setSignedIn(!!v));
    const unsubAuthState = onKeyChanged<AuthState>('auth.state', (v) =>
      setAuthState(v ?? 'signed-out'),
    );
    const unsubMembership = onKeyChanged<DestinyMembership | null>(
      'auth.primaryMembership',
      (v) => setMembership(v ?? null),
    );
    const unsubChar = onKeyChanged<ActiveCharacter | null>(
      'auth.activeCharacter',
      (v) => setActiveCharacter(v ?? null),
    );
    const unsubScoring = onKeyChanged('scoring-config', () => {
      setAutoLock(loadScoringConfig().autoLockOnArmorMatch);
    });
    const tickId = window.setInterval(() => setNowTick(Date.now()), 15_000);
    return () => {
      unsubFeed();
      unsubTokens();
      unsubAuthState();
      unsubMembership();
      unsubChar();
      unsubScoring();
      window.clearInterval(tickId);
    };
  }, []);

  const handleAutoLockToggle = useCallback(() => {
    const next = !autoLock;
    setAutoLock(next);
    const cfg = loadScoringConfig();
    saveScoringConfig({ ...cfg, autoLockOnArmorMatch: next });
  }, [autoLock]);

  const openDashboard = useCallback((instanceId?: string) => {
    if (instanceId) {
      const nav: PendingNavigation = { tab: 'drops', instanceId };
      chrome.storage.local.set({ [`cryptarch:${PENDING_NAV_KEY}`]: nav });
    }
    chrome.runtime.openOptionsPage();
    window.close();
  }, []);

  const handleReconnect = useCallback(async () => {
    setReconnectPending(true);
    await send({ type: 'auth-start' });
    setReconnectPending(false);
  }, []);

  const visibleDrops = useMemo(() => feed.slice(0, MAX_ROWS), [feed]);
  const showExpiredBanner = authState === 'expired';
  const displayName = membership?.displayName ?? 'GUARDIAN';

  return (
    <div className="d-cursor-root relative flex flex-col min-h-[600px] bg-d-bg-deep text-d-text font-outfit">
      <SacredBg opacity={0.5} />
      <div className="relative z-10 flex flex-col flex-1">
        {showExpiredBanner && (
          <ExpiredBanner pending={reconnectPending} onReconnect={handleReconnect} />
        )}

        <Header signedIn={signedIn} displayName={displayName} />

        <GuardianStrip
          displayName={displayName}
          signedIn={signedIn}
          character={activeCharacter}
        />

        {signedIn ? (
          <>
            <DropFeed
              drops={visibleDrops}
              nowTick={nowTick}
              onOpen={openDashboard}
            />
            <AutoLockRow on={autoLock} onToggle={handleAutoLockToggle} />
          </>
        ) : (
          <SignedOutPrompt onSignIn={() => openDashboard()} />
        )}

        <Footer onOpen={() => openDashboard()} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                            Sub-components                           */
/* ------------------------------------------------------------------ */

function ExpiredBanner({
  pending,
  onReconnect,
}: {
  pending: boolean;
  onReconnect: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-d-gold-line bg-d-gold-dim">
      <span className="text-d-10 text-d-gold uppercase tracking-d-wide">
        Bungie connection expired
      </span>
      <Btn variant="primary" small onClick={onReconnect} disabled={pending}>
        {pending ? 'Waiting…' : 'Reconnect →'}
      </Btn>
    </div>
  );
}

function Header({
  signedIn,
  displayName,
}: {
  signedIn: boolean;
  displayName: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-d-hairline">
      <div className="flex items-center gap-2.5">
        <img
          src={chrome.runtime.getURL('icons/icon48.png')}
          alt=""
          className="w-5 h-5 border border-d-gold-line"
          aria-hidden
        />
        <span className="text-d-12 font-light uppercase tracking-d-headline text-d-text">
          Cryptarch
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-d-9 uppercase tracking-d-wide text-d-text-muted">
        <span
          aria-hidden
          className={`w-[6px] h-[6px] ${signedIn ? 'bg-d-keep' : 'bg-d-text-dim'}`}
        />
        <span className="truncate max-w-[140px]">{displayName}</span>
      </div>
    </div>
  );
}

function GuardianStrip({
  displayName,
  signedIn,
  character,
}: {
  displayName: string;
  signedIn: boolean;
  character: ActiveCharacter | null;
}): JSX.Element {
  const emblemIcon = bungieImageUrl(character?.emblemPath);
  const emblemBg = bungieImageUrl(character?.emblemBackgroundPath);
  // The wide emblem nameplate is rendered as an <img> anchored to the right
  // edge with a left-fading mask, so the decorative pattern dissolves into
  // the dark backdrop instead of hard-cutting where the image ends. Anchoring
  // right keeps the meaningful decoration visible (its left third is mostly
  // the in-game name overlay zone — empty for us) and lets the popup's icon
  // + text on the left sit on flat dark space.
  return (
    <div
      className="relative w-full h-[64px] flex items-center px-4 border-b border-d-hairline overflow-hidden"
      style={{ background: '#15181c' }}
    >
      {emblemBg && (
        <img
          src={emblemBg}
          alt=""
          aria-hidden
          className="absolute right-0 top-0 h-full w-auto pointer-events-none select-none"
          style={{
            objectFit: 'cover',
            maskImage:
              'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.85) 55%, black 100%)',
            WebkitMaskImage:
              'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.85) 55%, black 100%)',
          }}
        />
      )}
      <div className="relative flex items-center gap-3 flex-1 min-w-0 z-10">
        <div
          className="w-9 h-9 flex-shrink-0 border border-d-hairline overflow-hidden bg-d-bg-pressed flex items-center justify-center"
          aria-hidden
        >
          {emblemIcon ? (
            <img
              src={emblemIcon}
              alt=""
              className="w-full h-full"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <span className="text-d-gold-line text-d-10">◆</span>
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-d-9 uppercase tracking-d-wide text-white/55">
            Active Guardian
          </span>
          <span className="text-d-12 font-light text-d-text truncate">
            {signedIn ? displayName : 'Not signed in'}
          </span>
          {signedIn && character && (
            <span className="text-d-9 uppercase tracking-d-wide text-d-text-sec truncate">
              {classLabel(character.classType)}
            </span>
          )}
        </div>
      </div>
      <div className="relative flex flex-col items-end flex-shrink-0 z-10">
        <span className="text-d-9 uppercase tracking-d-wide text-white/55">
          Last Sweep
        </span>
        <span className="text-d-11 font-medium text-d-gold">
          {signedIn ? '—' : 'Idle'}
        </span>
      </div>
    </div>
  );
}

function DropFeed({
  drops,
  nowTick,
  onOpen,
}: {
  drops: DropFeedEntry[];
  nowTick: number;
  onOpen: (instanceId?: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 pt-3 pb-2">
        <SectionHead>Recent Drops</SectionHead>
      </div>
      <div className="flex flex-col gap-1 px-2 pb-2 overflow-y-auto d-scroll" style={{ maxHeight: 340 }}>
        {drops.length === 0 ? (
          <div className="text-d-11 text-d-text-muted text-center py-6 px-3">
            No drops yet. Play Destiny 2 to see drops appear here.
          </div>
        ) : (
          drops.map((entry) => (
            <NotifRow
              key={entry.instanceId}
              entry={entry}
              nowTick={nowTick}
              onClick={() => onOpen(entry.instanceId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NotifRow({
  entry,
  nowTick,
  onClick,
}: {
  entry: DropFeedEntry;
  nowTick: number;
  onClick: () => void;
}): JSX.Element {
  const grade = deriveGrade(entry);
  const deleted = entry.deleted === true;

  // Gold is reserved for exotics; god rolls take the legendary purple tint
  // (the gold GOD ROLL badge is signal enough).
  const accentColor =
    grade === 'exotic'
      ? 'rgba(212,175,55,0.6)'
      : grade === 'shard'
      ? 'rgba(194,58,58,0.45)'
      : grade === 'keep'
      ? 'rgba(90,158,111,0.45)'
      : grade === 'god'
      ? 'rgba(157,113,199,0.65)'
      : 'rgba(157,113,199,0.45)';

  const rowBg = (() => {
    if (grade === 'shard') return 'rgba(0,0,0,0.15)';
    if (grade === 'god')
      return 'linear-gradient(90deg, rgba(82,47,101,0.18) 0%, transparent 50%)';
    if (grade === 'exotic')
      return 'linear-gradient(90deg, rgba(212,175,55,0.05) 0%, transparent 40%)';
    return 'transparent';
  })();

  const nameColor = entry.isExotic
    ? 'text-d-exotic'
    : entry.itemType === 'weapon'
    ? 'text-d-legendary'
    : 'text-d-text';

  const subtitle =
    entry.itemType === 'weapon' ? buildWeaponSubtitle(entry) : buildArmorSubtitle(entry);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2.5 px-3 py-2 text-left hover:bg-d-bg-hover transition-colors duration-d-fast ${
        deleted ? 'opacity-50' : ''
      }`}
      style={{
        borderLeft: `3px solid ${accentColor}`,
        background: rowBg,
        textShadow: grade === 'god' ? '0 0 8px rgba(157,113,199,0.3)' : 'none',
      }}
    >
      <WeaponIcon
        iconUrl={entry.itemIcon}
        size={36}
        isExotic={entry.isExotic}
        isGodRoll={grade === 'god'}
        itemType={entry.itemType}
      />
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span
          className={`text-d-11 font-medium uppercase tracking-d-wide truncate ${nameColor} ${
            grade === 'shard' ? 'opacity-50' : ''
          } ${deleted ? 'line-through' : ''}`}
        >
          {entry.itemName}
        </span>
        <span className="text-d-9 text-d-text-muted uppercase tracking-d-wide truncate">
          {subtitle ?? (deleted ? 'Dismantled' : 'Item')}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {grade && <GradeBadge grade={grade} small />}
        <span className="text-d-9 text-d-text-muted uppercase tracking-d-wide whitespace-nowrap w-12 text-right">
          {deleted ? '—' : formatRelative(nowTick - entry.timestamp)}
        </span>
      </div>
    </button>
  );
}

function AutoLockRow({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-d-hairline">
      <span className="text-d-9 uppercase tracking-d-wide text-d-text-sec">
        Auto-Lock Matches
      </span>
      <Toggle on={on} onToggle={onToggle} ariaLabel="Auto-lock matches" />
    </div>
  );
}

function SignedOutPrompt({ onSignIn }: { onSignIn: () => void }): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-3 text-center">
      <div className="text-d-11 text-d-text-muted uppercase tracking-d-wide">
        Not signed in
      </div>
      <p className="text-d-11 text-d-text-sec leading-relaxed">
        Sign in with Bungie.net from the dashboard to start tracking drops.
      </p>
      <Btn variant="primary" onClick={onSignIn}>
        Open Dashboard →
      </Btn>
    </div>
  );
}

function Footer({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <div className="px-4 pt-2.5 pb-3.5 border-t border-d-hairline flex flex-col gap-1.5">
      <BracketBtn fullWidth onClick={onOpen}>
        Open Dashboard
      </BracketBtn>
      <a
        href="https://ko-fi.com/frailrain"
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-d-9 uppercase tracking-d-wide text-d-text-dim hover:text-d-gold-pale transition-colors duration-d-fast"
      >
        Buy me a coffee ☕
      </a>
    </div>
  );
}
