import { useMemo } from 'react';
import type { DropFeedEntry, TierLetter } from '@/shared/types';
import { TierChip } from '../components/TierChip';

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

function LockIcon({ locked, shouldShow }: { locked: boolean; shouldShow: boolean }) {
  if (!shouldShow) {
    return <span className="w-4 h-4 inline-block" aria-hidden="true" />;
  }
  return (
    <span
      className={locked ? 'text-rahool-yellow' : 'text-text-muted/60'}
      title={locked ? 'Auto-locked' : 'Lock pending or failed'}
      aria-label={locked ? 'locked' : 'not locked'}
    >
      {locked ? '🔒' : '○'}
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
        <h2 className="text-base font-medium text-text-primary">Drop Log</h2>
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
}: {
  entry: DropFeedEntry;
  nowTick: number;
  highlighted: boolean;
}) {
  const isArmor = entry.itemType === 'armor';
  const isMatchedArmor = isArmor && entry.armorMatched === true;
  const isKeeperWeapon = !isArmor && entry.grade === 'S';
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
  const lockRelevant = (isArmor && entry.armorMatched === true) || entry.grade === 'S';

  return (
    <li
      data-instance-id={entry.instanceId}
      className={`py-2.5 flex items-center gap-3 px-2 rounded ${tinted} ${
        highlighted ? 'pulse-highlight' : ''
      } ${entry.deleted ? 'opacity-60' : ''}`}
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
      <div className="flex items-center gap-1">
        {entry.perkIcons.slice(0, 4).map((icon, i) => (
          <img key={i} src={icon} alt="" className="w-6 h-6 rounded" />
        ))}
      </div>
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
      <LockIcon locked={entry.locked} shouldShow={lockRelevant && !entry.deleted} />
      <div className="text-xs text-text-muted w-20 text-right">
        {entry.deleted
          ? `Dismantled ${formatRelativeTimestamp(nowTick - entry.timestamp)}`
          : formatRelativeTimestamp(nowTick - entry.timestamp)}
      </div>
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
