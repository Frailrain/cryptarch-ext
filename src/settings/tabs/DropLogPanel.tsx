import { useEffect, useMemo, useState } from 'react';
import type { DropFeedEntry, TierLetter } from '@/shared/types';
import { TierChip } from '../components/TierChip';
import { DropDetailExpand } from '../components/DropDetailExpand';
import { RolledPerkRow } from '../components/RolledPerkRow';
import { requestPerkPool } from '@/adapters/perk-pool-messages';

const TIER_FILTER_ORDER: TierLetter[] = ['S', 'A', 'B', 'C', 'D', 'F'];

export type DropTypeFilter = 'all' | 'weapon' | 'armor';
export type DropMatchFilter = 'all' | 'matched' | 'not-matched';

// Brief #12 follow-up: GradeChip removed from row rendering. The grade field
// stays on DropFeedEntry until Part H rewires notifications to use
// WeaponFilterConfig instead of the legacy grade threshold; we just stopped
// surfacing it in the Drop Log because the user-visible distinction between
// per-roll grade and per-weapon tier was muddled.

function ExoticChip() {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-6 rounded text-xs font-semibold border bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50"
      aria-label="exotic"
      title="Exotic"
    >
      Ex
    </span>
  );
}

function MatchChip({ matched }: { matched: boolean }) {
  return matched ? (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold border bg-grade-s/20 text-grade-s border-grade-s/50"
      aria-label="matched"
      title="Matched a rule"
    >
      ✓
    </span>
  ) : (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold border bg-bg-border text-text-muted border-bg-border"
      aria-label="not matched"
      title="No rule match"
    >
      ✗
    </span>
  );
}

function LockIcon({
  locked,
  shouldShow,
  onLock,
}: {
  locked: boolean;
  shouldShow: boolean;
  // When provided and the drop isn't already locked, the unlocked icon
  // becomes a clickable button that triggers a manual lock via the SW.
  // Omit (or pass undefined) for entries that can't be manually locked
  // — test drops, ghost entries, anything missing characterId.
  onLock?: () => void;
}) {
  if (!shouldShow) {
    return <span className="w-4 h-4 inline-block" aria-hidden="true" />;
  }
  if (locked) {
    return (
      <span className="text-rahool-yellow" title="Locked" aria-label="locked">
        🔒
      </span>
    );
  }
  if (onLock) {
    return (
      <button
        type="button"
        onClick={(e) => {
          // Brief #14 Part E: row body is clickable for expand. Stop propagation
          // here so a lock click doesn't also toggle the expand state.
          e.stopPropagation();
          onLock();
        }}
        title="Click to lock this drop"
        aria-label="lock this drop"
        className="text-text-muted/60 hover:text-rahool-yellow cursor-pointer"
      >
        ○
      </button>
    );
  }
  return (
    <span
      className="text-text-muted/60"
      title="Lock pending or failed"
      aria-label="not locked"
    >
      ○
    </span>
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
  // Brief #12: tier visibility set. Untiered drops are unaffected (always
  // shown) — only drops with weaponTier metadata are subject to this filter.
  visibleTiers: Set<TierLetter>;
  nowTick: number;
  // When set (from popup deep-link), the matching row renders with
  // pulse-highlight for ~1.5s after scroll-into-view.
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

  // Brief #14 Part E: which row (if any) is expanded inline. Single-expand
  // policy keeps visual noise low and matches DIM's interaction.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Brief #14 Part E idle-time prewarm: as soon as the dashboard mounts,
  // kick off perk-pool fetches for the most recent 10 unique weapon hashes
  // in the feed. The SW's tiered cache + in-flight guard mean this is safe
  // to fire-and-forget; second-and-later opens of the same drop are then
  // instant. We only prewarm weapons (armor has no random-roll perk pool
  // worth looking up here).
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
    // Re-run whenever the feed changes (new drops shift the recency window).
    // Cheap because the cache hits short-circuit; only genuinely new hashes
    // pay the resolve cost.
  }, [feed]);

  const visible = useMemo(() => {
    return feed.filter((e) => {
      // No test-drop bypass: all filters apply uniformly. The original bypass
      // existed to keep test drops visible when grade filters might hide them,
      // but grade chips are no longer in the filter row, and users testing the
      // type/match/tier filters now expect them to work on test drops too.
      // The "[Test]" name prefix is enough visual distinction.
      if (typeFilter !== 'all' && e.itemType !== typeFilter) return false;
      if (e.isExotic) return showExotic;
      if (e.itemType === 'weapon') {
        // Tier filter only applies to drops with weaponTier metadata; untiered
        // drops (Voltron-only matches without Aegis tier references, pre-#12
        // entries) always pass.
        if (e.weaponTier && !visibleTiers.has(e.weaponTier)) return false;
        return true;
      }
      if (matchFilter === 'matched' && e.armorMatched !== true) return false;
      if (matchFilter === 'not-matched' && e.armorMatched !== false) return false;
      return true;
    });
  }, [feed, typeFilter, matchFilter, showExotic, visibleTiers]);

  return (
    <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-medium text-text-primary">Drop Log</h2>
          <button
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
            className="text-xs px-2 py-1 rounded border border-bg-border text-text-muted hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear log
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
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
          {/* Tier and Match always render — disabled when type filter excludes
              their domain. Avoids layout shift as the user changes Type. */}
          <div
            className={`flex items-center gap-1 ${weaponFilterRelevant ? '' : 'opacity-40'}`}
          >
            <span className="text-text-muted mr-1">Tier</span>
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
          <button
            onClick={props.onToggleExotic}
            className={`px-2 py-1 rounded border text-xs ${
              showExotic
                ? 'bg-grade-exotic/20 text-grade-exotic border-grade-exotic/50'
                : 'bg-bg-primary text-text-muted border-bg-border'
            }`}
          >
            Exotic
          </button>
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

      {visible.length === 0 ? (
        <div className="text-sm text-text-muted py-6 text-center">
          {feed.length === 0
            ? 'No drops yet. Drops will appear here as Cryptarch scores them.'
            : 'No drops match the current filters.'}
        </div>
      ) : (
        <ul className="divide-y divide-bg-border">
          {visible.map((entry) => (
            <DropLogRow
              key={entry.instanceId}
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
          ))}
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
    <div className={`flex items-center gap-1 ${props.disabled ? 'opacity-40' : ''}`}>
      <span className="text-text-muted mr-1">{props.label}</span>
      {props.options.map((opt) => {
        const active = props.value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={props.disabled ? undefined : () => props.onChange(opt.value)}
            disabled={props.disabled}
            className={`px-2 py-1 rounded border ${
              active
                ? 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40'
                : 'bg-bg-primary text-text-muted border-bg-border hover:text-text-primary'
            } ${props.disabled ? 'cursor-not-allowed' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
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
  // Brief #12.5 Part C: was `entry.grade === 'S'`. Grade S meant "any wishlist
  // flagged this roll as a keeper" — same semantics as wishlistMatches.length>0.
  const isKeeperWeapon = !isArmor && (entry.wishlistMatches?.length ?? 0) > 0;
  // Row bg encodes "worth your attention" — green for matched exotic armor,
  // lavender for non-exotic keepers (matched armor + S-tier weapons). Exotic
  // weapons and unmatched exotic armor get no tint; the yellow Ex chip
  // already carries the rarity signal.
  const tinted = entry.isExotic
    ? isMatchedArmor
      ? 'bg-emerald-500/10 hover:bg-emerald-500/20'
      : 'hover:bg-bg-border/40'
    : isMatchedArmor || isKeeperWeapon
      ? 'bg-grade-s/5 hover:bg-grade-s/10'
      : 'hover:bg-bg-border/40';

  const subtitle = isArmor ? buildArmorSubtitle(entry) : entry.weaponType ?? 'Weapon';
  const lockRelevant =
    (isArmor && entry.armorMatched === true) ||
    (entry.wishlistMatches?.length ?? 0) > 0;

  // Brief #14 Part E: rows with a known itemHash are clickable to expand
  // the perk-pool detail view. Pre-#14 entries (no itemHash) and ghost
  // entries fall through as non-clickable — nothing to look up for them.
  const expandable = entry.itemHash !== undefined && !entry.deleted;

  return (
    <li
      data-instance-id={entry.instanceId}
      className={`py-2.5 px-2 rounded ${tinted} ${
        highlighted ? 'pulse-highlight' : ''
      } ${entry.deleted ? 'opacity-60' : ''}`}
    >
      <div
        className={`flex items-center gap-3 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={expandable ? onToggleExpand : undefined}
      >
      {entry.itemIcon ? (
        <img
          src={entry.itemIcon}
          alt=""
          className={`w-10 h-10 rounded border ${entry.isExotic ? 'border-grade-exotic/60' : 'border-bg-border'} ${entry.deleted ? 'grayscale' : ''}`}
        />
      ) : (
        <div className="w-10 h-10 rounded border border-bg-border bg-bg-primary" />
      )}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm truncate ${entry.isExotic ? 'text-grade-exotic' : 'text-text-primary'} ${entry.deleted ? 'line-through' : ''}`}
        >
          {entry.itemName}
        </div>
        <div className="text-xs text-text-muted truncate">{subtitle}</div>
        {/* Wishlist source tags below the subtitle. Brief #12 follow-up
            removed the redundant left-side tier chip from this row; tier
            now lives in the right-side chip slot below where the grade
            chip used to live. */}
        {entry.wishlistMatches && entry.wishlistMatches.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {entry.wishlistMatches.map((m) => (
              <span
                key={m.sourceId}
                title={m.notes || m.sourceName}
                className="text-[10px] px-1.5 py-0.5 rounded border bg-rahool-blue/15 text-rahool-blue border-rahool-blue/40"
              >
                {m.sourceName}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Brief #14.4: collapsed-row perk icons. Visual treatment derived
          from the display model in RolledPerkRow → PerkIcon; this panel
          contains zero direct visual logic. */}
      <RolledPerkRow entry={entry} iconSize={28} />
      {/* Right-side chip slot. Brief #12 follow-up: tier chip replaces the
          grade chip for legendary weapons; exotic and armor-match chips
          unchanged (those are different concepts from tier). Empty slot when
          a weapon has no tier metadata — grade is no longer surfaced here. */}
      {entry.isExotic ? (
        <ExoticChip />
      ) : isArmor ? (
        entry.armorMatched === null ? (
          <span className="w-6 h-6 inline-block" aria-hidden="true" />
        ) : (
          <MatchChip matched={entry.armorMatched} />
        )
      ) : entry.weaponTier ? (
        <TierChip tier={entry.weaponTier} compact />
      ) : (
        <span className="w-6 h-6 inline-block" aria-hidden="true" />
      )}
      <LockIcon
        locked={entry.locked}
        shouldShow={lockRelevant && !entry.deleted}
        // Manual-lock click handler is provided only when the entry is
        // lockable: real drop with a characterId (test drops and ghost
        // entries lack one), not deleted. Already-locked drops show 🔒
        // and don't render the button branch.
        onLock={
          entry.characterId && !entry.deleted
            ? () => onLockDrop(entry.instanceId)
            : undefined
        }
      />
      <div className="text-xs text-text-muted w-20 text-right">
        {entry.deleted
          ? `Dismantled ${formatRelativeTimestamp(nowTick - entry.timestamp)}`
          : formatRelativeTimestamp(nowTick - entry.timestamp)}
      </div>
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
