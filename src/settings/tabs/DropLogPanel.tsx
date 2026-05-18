// Brief #23 Phase B rewrite — Destiny-native Drop Log.
//
// Pre-#23 wrapped a `bg-bg-card` panel inside Settings.tsx's outer Panel,
// double-bordering at the seam. Now the outer Panel (with corner ticks) IS
// the surface; this file renders a header + filter row + drop list inside
// it, no inner card chrome.
//
// Drop rows mirror the popup's NotifRow design: left-border rarity accent,
// WeaponIcon, name + element pip + subtitle column, RolledPerkRow at the
// right, tier/exotic/match chip, lock button. Tints, voltron confirmation
// indicator, and expand-on-click behavior all preserved from the legacy
// version — the rewrite is visual only.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DropFeedEntry, TierLetter } from '@/shared/types';
import { TierChip } from '../components/TierChip';
import { DropDetailExpand } from '../components/DropDetailExpand';
import { DropNotification } from '../components/DropNotification';
import { RolledPerkRow } from '../components/RolledPerkRow';
import { requestPerkPool } from '@/adapters/perk-pool-messages';
import { Btn, Chip, GradeBadge, Headline, SectionHead, WeaponIcon } from '@/components/destiny';

const TIER_FILTER_ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];

export type DropTypeFilter = 'all' | 'weapon' | 'armor';
export type DropMatchFilter = 'all' | 'matched' | 'not-matched';

function LockSlot({
  locked,
  lockable,
  onLock,
}: {
  locked: boolean;
  lockable: boolean;
  onLock: (e: React.MouseEvent) => void;
}) {
  if (locked) {
    return (
      <span
        className="inline-flex items-center justify-center min-w-[52px] h-[26px] px-2 text-d-11 font-medium uppercase tracking-d-wide text-d-gold border border-d-gold-line bg-d-gold-dim d-text-shadow-gold flex-shrink-0"
        title="Locked"
        aria-label="locked"
      >
        Locked
      </span>
    );
  }
  if (!lockable) return null;
  return (
    <button
      type="button"
      onClick={onLock}
      title="Lock this drop"
      aria-label="Lock this drop"
      className="inline-flex items-center justify-center min-w-[52px] h-[26px] px-2 text-d-11 font-medium uppercase tracking-d-wide text-d-text-sec border border-d-hairline hover:text-d-gold hover:border-d-gold-line hover:bg-d-gold-dim transition-colors duration-d-fast flex-shrink-0"
    >
      Lock
    </button>
  );
}

function formatRelativeTimestamp(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface DropLogPanelProps {
  feed: DropFeedEntry[];
  typeFilter: DropTypeFilter;
  matchFilter: DropMatchFilter;
  showExotic: boolean;
  visibleTiers: Set<TierLetter>;
  nowTick: number;
  highlightInstanceId?: string | null;
  onTypeFilterChange: (v: DropTypeFilter) => void;
  onMatchFilterChange: (v: DropMatchFilter) => void;
  onToggleExotic: () => void;
  onToggleTier: (tier: TierLetter) => void;
  onClearFeed: () => void;
  onLockDrop: (instanceId: string) => void;
}

export function DropLogPanel(props: DropLogPanelProps) {
  const {
    feed,
    typeFilter,
    matchFilter,
    showExotic,
    visibleTiers,
    nowTick,
    highlightInstanceId,
  } = props;

  const weaponFilterRelevant = typeFilter !== 'armor';
  const matchFilterRelevant = typeFilter !== 'weapon';

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Ids present when the dashboard mounted — those render statically. Anything
  // new that arrives via subsequent feed updates queues into animatingIds for
  // the D2-style engram→decrypt→banner sequence. Stagger uses queue order:
  // index 0 fires immediately, index 1 starts +1200ms, etc.
  const seenIdsRef = useRef<Set<string>>(new Set(feed.map((e) => e.instanceId)));
  const [animatingIds, setAnimatingIds] = useState<string[]>([]);
  useEffect(() => {
    const fresh: string[] = [];
    for (const entry of feed) {
      if (!seenIdsRef.current.has(entry.instanceId)) {
        seenIdsRef.current.add(entry.instanceId);
        fresh.push(entry.instanceId);
      }
    }
    if (fresh.length > 0) {
      setAnimatingIds((prev) => [...prev, ...fresh]);
    }
  }, [feed]);

  // Brief #14 Part E idle prewarm: fetch perk pools for the most recent 10
  // unique weapon hashes so expand-on-click is instant. SW's tiered cache +
  // in-flight guard make repeats cheap.
  useEffect(() => {
    const seen = new Set<number>();
    for (const e of feed) {
      if (e.itemType !== 'weapon') continue;
      if (e.itemHash === undefined) continue;
      if (seen.has(e.itemHash)) continue;
      seen.add(e.itemHash);
      if (seen.size >= 10) break;
    }
    for (const hash of seen) {
      void requestPerkPool(hash);
    }
  }, [feed]);

  const visible = useMemo(() => {
    return feed.filter((e) => {
      if (typeFilter !== 'all' && e.itemType !== typeFilter) return false;
      if (e.isExotic) return showExotic;
      if (e.itemType === 'weapon') {
        if (e.weaponTier && !visibleTiers.has(e.weaponTier)) return false;
        return true;
      }
      if (matchFilter === 'matched' && e.armorMatched !== true) return false;
      if (matchFilter === 'not-matched' && e.armorMatched !== false) return false;
      return true;
    });
  }, [feed, typeFilter, matchFilter, showExotic, visibleTiers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Headline size="sm">Drop Log</Headline>
          <Btn
            variant="ghost"
            small
            onClick={() => {
              if (feed.length === 0) return;
              if (
                window.confirm(
                  `Clear all ${feed.length} drop${feed.length === 1 ? '' : 's'} from the log? This cannot be undone.`,
                )
              ) {
                props.onClearFeed();
              }
            }}
            disabled={feed.length === 0}
            title={feed.length === 0 ? 'Log is empty' : 'Clear all drops'}
          >
            Clear Log
          </Btn>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <FilterGroup
            label="Type"
            options={[
              { value: 'all', label: 'All' },
              { value: 'weapon', label: 'Weapons' },
              { value: 'armor', label: 'Armor' },
            ]}
            value={typeFilter}
            onChange={(v) => props.onTypeFilterChange(v as DropTypeFilter)}
          />
          <div className={`flex items-center gap-1.5 ${weaponFilterRelevant ? '' : 'opacity-40'}`}>
            <span className="text-d-11 uppercase tracking-d-wide text-d-text-muted mr-0.5">
              Tier
            </span>
            {TIER_FILTER_ORDER.map((tier) => (
              <TierChip
                key={tier}
                tier={tier}
                active={visibleTiers.has(tier)}
                onClick={() => props.onToggleTier(tier)}
                title={`Tier ${tier}`}
                disabled={!weaponFilterRelevant}
              />
            ))}
          </div>
          <Chip
            active={showExotic}
            color="exotic"
            onClick={props.onToggleExotic}
          >
            Exotic
          </Chip>
          <FilterGroup
            label="Match"
            options={[
              { value: 'all', label: 'All' },
              { value: 'matched', label: 'Matched' },
              { value: 'not-matched', label: 'No match' },
            ]}
            value={matchFilter}
            onChange={(v) => props.onMatchFilterChange(v as DropMatchFilter)}
            disabled={!matchFilterRelevant}
          />
        </div>
      </div>

      <SectionHead>{visible.length} drops</SectionHead>

      {visible.length === 0 ? (
        <div className="text-d-11 text-d-text-muted text-center py-8">
          {feed.length === 0
            ? 'No drops yet. Drops will appear here as Cryptarch scores them.'
            : 'No drops match the current filters.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((entry) => {
            const row = (
              <DropLogRow
                entry={entry}
                nowTick={nowTick}
                highlighted={entry.instanceId === highlightInstanceId}
                onLockDrop={props.onLockDrop}
                expanded={expandedId === entry.instanceId}
                onToggleExpand={() =>
                  setExpandedId((prev) =>
                    prev === entry.instanceId ? null : entry.instanceId,
                  )
                }
              />
            );
            const staggerIndex = animatingIds.indexOf(entry.instanceId);
            // Anything not in the queue falls through to the static render
            // path. Everything else animates — shards included; they get
            // the red engram so dismantles still feel ceremonious.
            if (staggerIndex < 0) {
              return <div key={entry.instanceId}>{row}</div>;
            }
            const isArmor = entry.itemType === 'armor';
            const matched =
              (entry.wishlistMatches ?? []).some((m) => m.notificationOnly !== true) ||
              (isArmor && entry.armorMatched === true);
            const animGrade: 'god' | 'keep' | 'exotic' | 'shard' = entry.isExotic
              ? 'exotic'
              : !matched
                ? 'shard'
                : entry.weaponTier === 'S'
                  ? 'god'
                  : 'keep';
            const rarityColor =
              animGrade === 'exotic'
                ? '#d4af37'
                : animGrade === 'god'
                  ? '#c69cf0'
                  : animGrade === 'shard'
                    ? '#c23a3a'
                    : '#5a9e6f';
            const rarityGlow =
              animGrade === 'exotic'
                ? 'rgba(212,175,55,0.6)'
                : animGrade === 'god'
                  ? 'rgba(157,113,199,0.5)'
                  : animGrade === 'shard'
                    ? 'rgba(194,58,58,0.5)'
                    : 'rgba(90,158,111,0.4)';
            return (
              <DropNotification
                key={entry.instanceId}
                rarityColor={rarityColor}
                rarityGlow={rarityGlow}
                staggerIndex={staggerIndex}
                rowHeight={72}
                onComplete={() =>
                  setAnimatingIds((prev) => prev.filter((x) => x !== entry.instanceId))
                }
              >
                {row}
              </DropNotification>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterGroup<T extends string>(props: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${props.disabled ? 'opacity-40' : ''}`}>
      <span className="text-d-11 uppercase tracking-d-wide text-d-text-muted mr-0.5">
        {props.label}
      </span>
      {props.options.map((opt) => (
        <Chip
          key={opt.value}
          active={props.value === opt.value}
          color="gold"
          onClick={props.disabled ? undefined : () => props.onChange(opt.value)}
          disabled={props.disabled}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  );
}

type Grade = 'god' | 'keep' | 'exotic' | 'shard';

// Grade derivation:
//   exotic    → always 'exotic'
//   armor     → 'keep' when armorMatched, null otherwise (armor uses rules, not threshold)
//   weapon    → 'god' if matched at tier S, 'keep' if matched below S,
//               'shard' if no wishlist match passed the user's tier+PPC threshold.
// "No match" == below threshold, so it gets the shard treatment even if the
// raw tier letter would be C/D — the appraiser is telling you to dismantle.
function deriveGrade(
  entry: DropFeedEntry,
  isArmor: boolean,
  isKeeperWeapon: boolean,
  isMatchedArmor: boolean,
): Grade | null {
  if (entry.isExotic) return 'exotic';
  if (isArmor) return isMatchedArmor ? 'keep' : null;
  if (isKeeperWeapon) return entry.weaponTier === 'S' ? 'god' : 'keep';
  return 'shard';
}

function DropLogRow({
  entry,
  nowTick,
  highlighted,
  onLockDrop,
  expanded,
  onToggleExpand,
}: {
  entry: DropFeedEntry;
  nowTick: number;
  highlighted: boolean;
  onLockDrop: (instanceId: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const isArmor = entry.itemType === 'armor';
  const isMatchedArmor = isArmor && entry.armorMatched === true;
  const visibleWishlistMatches = (entry.wishlistMatches ?? []).filter(
    (m) => m.notificationOnly !== true,
  );
  const isKeeperWeapon = !isArmor && visibleWishlistMatches.length > 0;
  const grade = deriveGrade(entry, isArmor, isKeeperWeapon, isMatchedArmor);

  // Brief #23: left-border rarity accent + gradient tint. Gold is reserved
  // for exotics; god rolls take the legendary purple tint to match the brief's
  // color table (gold lives only in the GOD ROLL badge and BracketBtn CTAs).
  const accentColor = (() => {
    if (grade === 'exotic') return 'rgba(212,175,55,0.6)';
    if (grade === 'shard') return 'rgba(194,58,58,0.45)';
    if (grade === 'keep') return 'rgba(90,158,111,0.45)';
    if (grade === 'god') return 'rgba(157,113,199,0.65)'; // brighter legendary
    if (!isArmor) return 'rgba(157,113,199,0.45)';
    return 'rgba(255,255,255,0.15)';
  })();
  const rowBg = (() => {
    if (grade === 'shard') return 'rgba(0,0,0,0.20)';
    if (grade === 'god')
      return 'linear-gradient(90deg, rgba(82,47,101,0.18) 0%, transparent 55%)';
    if (grade === 'exotic')
      return 'linear-gradient(90deg, rgba(212,175,55,0.05) 0%, transparent 50%)';
    if (grade === 'keep')
      return 'linear-gradient(90deg, rgba(90,158,111,0.08) 0%, transparent 50%)';
    return 'transparent';
  })();

  const subtitle = isArmor ? buildArmorSubtitle(entry) : buildWeaponSubtitle(entry);
  const isKeeper = grade === 'god' || grade === 'keep' || grade === 'exotic';
  const lockable = isKeeper && !entry.deleted && !!entry.characterId;
  const expandable = entry.itemHash !== undefined && !entry.deleted;

  return (
    <li
      data-instance-id={entry.instanceId}
      className={`relative ${highlighted ? 'pulse-highlight' : ''} ${
        entry.deleted ? 'opacity-50' : ''
      } hover:bg-d-bg-hover transition-colors duration-d-fast`}
      style={{
        borderLeft: `3px solid ${accentColor}`,
        background: rowBg,
        textShadow: grade === 'god' ? '0 0 8px rgba(157,113,199,0.25)' : 'none',
      }}
    >
      <div
        className={`flex items-center gap-3.5 px-3 py-2.5 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={expandable ? onToggleExpand : undefined}
      >
        <WeaponIcon
          iconUrl={entry.itemIcon}
          size={52}
          isExotic={entry.isExotic}
          isGodRoll={grade === 'god'}
          itemType={entry.itemType}
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`text-d-14 font-medium uppercase tracking-d-wide truncate ${
                entry.isExotic
                  ? 'text-d-exotic'
                  : entry.itemType === 'weapon'
                    ? 'text-d-legendary'
                    : 'text-d-text'
              } ${grade === 'shard' ? 'opacity-50' : ''} ${entry.deleted ? 'line-through' : ''}`}
            >
              {entry.itemName}
            </span>
            {!isArmor && !entry.isExotic && entry.weaponTier && (
              <TierChip tier={entry.weaponTier} compact />
            )}
          </div>
          <div className="text-d-12 text-d-text-muted uppercase tracking-d-wide truncate">
            {subtitle}
          </div>
        </div>
        <RolledPerkRow entry={entry} iconSize={28} />
        <div className="inline-flex items-center gap-2 flex-shrink-0">
          {grade && <GradeBadge grade={grade} />}
        </div>
        <LockSlot
          locked={entry.locked}
          lockable={lockable}
          onLock={(e) => {
            e.stopPropagation();
            onLockDrop(entry.instanceId);
          }}
        />
        <div className="text-d-11 text-d-text-muted uppercase tracking-d-wide w-24 text-right whitespace-nowrap">
          {entry.deleted
            ? `Dismantled ${formatRelativeTimestamp(nowTick - entry.timestamp)}`
            : formatRelativeTimestamp(nowTick - entry.timestamp)}
        </div>
        {expandable && (
          <span
            className="text-d-14 text-d-text-muted font-light w-3 text-center flex-shrink-0"
            aria-hidden
          >
            {expanded ? '⌄' : '›'}
          </span>
        )}
      </div>
      {expanded && expandable && <DropDetailExpand entry={entry} />}
    </li>
  );
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

function buildWeaponSubtitle(entry: DropFeedEntry): string {
  const parts: string[] = [];
  if (entry.weaponType) parts.push(entry.weaponType);
  if (entry.weaponSlot) parts.push(entry.weaponSlot);
  if (entry.damageType && entry.damageType !== 'None') parts.push(entry.damageType);
  return parts.length > 0 ? parts.join(' · ') : 'Weapon';
}
