import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadWeaponFilterConfig,
  loadWishlistSources,
  saveWeaponFilterConfig,
  saveWishlistSources,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
import { refreshWishlists } from '@/core/wishlists/fetch';
import type {
  RollTypeFilter,
  TierFilter,
  WeaponFilterConfig,
  WishlistSource,
} from '@/shared/types';
import { WishlistsPanel } from './WishlistsPanel';

// Brief #12 Part E. Composes the new top-section filter UI with the existing
// (Brief #11) WishlistsPanel as the bottom "Manage sources" section.
//
// Preset semantics: a preset declares "this set of built-in sources should be
// enabled, others off." Custom sources are intentionally orthogonal — applying
// a preset does not touch them, and detection of the active preset only
// considers built-ins. Without that, a user with any custom source would always
// see "Custom" because their state could never match a preset's exact shape.

interface WishlistPreset {
  id: string;
  label: string;
  description: string;
  enabledBuiltinIds: Set<string>;
}

const PRESETS: WishlistPreset[] = [
  {
    id: 'recommended-starter',
    label: 'Recommended starter',
    description: 'Voltron broad coverage + Aegis Endgame for tier-rated rolls.',
    enabledBuiltinIds: new Set(['voltron', 'aegis-endgame']),
  },
  {
    id: 'strict-pve-keepers',
    label: 'Strict PVE keepers',
    description:
      "Aegis Exclusive (S-tier only) plus Voltron as a safety net for god-rolls Aegis hasn't curated yet.",
    enabledBuiltinIds: new Set(['voltron', 'aegis-exclusive']),
  },
  {
    id: 'pve-everything-tagged',
    label: 'PVE everything tagged',
    description:
      'Voltron + Choosy Voltron + Aegis Endgame. Broadest coverage; expect more notifications.',
    enabledBuiltinIds: new Set(['voltron', 'choosy-voltron', 'aegis-endgame']),
  },
];

// Built-in source IDs that ship Aegis-format tier metadata. Used by the soft
// warning that fires when a tier filter is active but no tier-providing source
// is enabled. Custom URLs that happen to be Aegis-format won't suppress this
// warning — a small false positive, but the alternative (inspecting cached
// entries for weaponTier presence) needs the wishlists key loaded which is
// lazy in this context.
const TIER_PROVIDING_BUILTIN_IDS = new Set(['aegis-endgame', 'aegis-exclusive']);

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function detectActivePreset(sources: WishlistSource[]): WishlistPreset | 'custom' {
  const enabledBuiltins = new Set(
    sources.filter((s) => s.builtin && s.enabled).map((s) => s.id),
  );
  for (const preset of PRESETS) {
    if (setsEqual(enabledBuiltins, preset.enabledBuiltinIds)) return preset;
  }
  return 'custom';
}

function applyPreset(preset: WishlistPreset, sources: WishlistSource[]): WishlistSource[] {
  return sources.map((s) => {
    if (!s.builtin) return s; // custom sources are independent of presets
    return { ...s, enabled: preset.enabledBuiltinIds.has(s.id) };
  });
}

function hasEnabledTierSource(sources: WishlistSource[]): boolean {
  return sources.some((s) => s.enabled && TIER_PROVIDING_BUILTIN_IDS.has(s.id));
}

const TIER_OPTIONS: { value: TierFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'S', label: 'S' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
  { value: 'F', label: 'F' },
];

const ROLL_TYPE_OPTIONS: { value: RollTypeFilter; label: string }[] = [
  { value: 'all-matched', label: 'All matched' },
  { value: 'strong-pve', label: 'Strong PVE' },
  { value: 'popular', label: 'Popular' },
];

export function WeaponsPanel() {
  const [sources, setSources] = useState<WishlistSource[]>(() => loadWishlistSources());
  const [filterConfig, setFilterConfig] = useState<WeaponFilterConfig>(() =>
    loadWeaponFilterConfig(),
  );

  useEffect(() => {
    const unsub1 = onKeyChanged<WishlistSource[]>('wishlistSources', (v) => {
      if (v) setSources(v);
    });
    const unsub2 = onKeyChanged<WeaponFilterConfig>('weaponFilterConfig', (v) => {
      if (v) setFilterConfig(v);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const activePreset = useMemo(() => detectActivePreset(sources), [sources]);

  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const next = applyPreset(preset, sources);
      setSources(next);
      saveWishlistSources(next);
      // Newly-enabled sources need a fetch; the per-source 24h staleness check
      // inside refreshWishlists handles already-fresh sources cheaply.
      void refreshWishlists(next).catch(() => {});
    },
    [sources],
  );

  const handleTierChange = useCallback(
    (tier: TierFilter) => {
      const next = { ...filterConfig, tierFilter: tier };
      setFilterConfig(next);
      saveWeaponFilterConfig(next);
    },
    [filterConfig],
  );

  const handleRollTypeChange = useCallback(
    (rt: RollTypeFilter) => {
      const next = { ...filterConfig, rollTypeFilter: rt };
      setFilterConfig(next);
      saveWeaponFilterConfig(next);
    },
    [filterConfig],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">What do you want to be notified about?</h2>
          <p className="text-sm text-text-muted">
            Pick a preset to enable a starter set of wishlist sources, then tune the tier and
            roll-type filters to control which matched drops fire notifications. Drop log shows
            everything regardless of these filters.
          </p>
        </div>

        <PresetPicker active={activePreset} onChange={handlePresetChange} />

        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-text-muted">Tier filter</div>
          <SegmentedControl
            options={TIER_OPTIONS}
            value={filterConfig.tierFilter}
            onChange={handleTierChange}
          />
          <div className="text-xs text-text-muted">
            Notify on weapons rated this tier or better. Only Aegis-format wishlists provide tier
            data.
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-text-muted">Roll-type filter</div>
          <SegmentedControl
            options={ROLL_TYPE_OPTIONS}
            value={filterConfig.rollTypeFilter}
            onChange={handleRollTypeChange}
          />
          <RollTypeDescription value={filterConfig.rollTypeFilter} />
        </div>

        <SoftWarnings sources={sources} filterConfig={filterConfig} />
      </div>

      <div className="space-y-3">
        <div className="px-1 space-y-0.5">
          <h3 className="text-sm font-medium text-text-primary">
            Manage individual wishlist sources
          </h3>
          <p className="text-xs text-text-muted">
            Most users won&apos;t need this. The presets above handle common cases.
          </p>
        </div>
        <WishlistsPanel showHeader={false} />
      </div>
    </div>
  );
}

function PresetPicker({
  active,
  onChange,
}: {
  active: WishlistPreset | 'custom';
  onChange: (presetId: string) => void;
}) {
  const isCustom = active === 'custom';
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-text-muted">Wishlist preset</div>
      <div className="flex flex-col gap-2">
        {PRESETS.map((preset) => {
          const isActive = !isCustom && active.id === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onChange(preset.id)}
              className={`text-left px-3 py-2 rounded border transition-colors ${
                isActive
                  ? 'bg-rahool-blue/15 border-rahool-blue/40'
                  : 'border-bg-border hover:border-bg-border/80 bg-bg-primary/40'
              }`}
            >
              <div
                className={`text-sm font-medium ${isActive ? 'text-rahool-blue' : 'text-text-primary'}`}
              >
                {preset.label}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{preset.description}</div>
            </button>
          );
        })}
        {isCustom && (
          <div className="text-xs text-text-muted px-3 py-2 rounded border border-bg-border bg-bg-primary/40">
            <span className="font-medium text-text-primary">Custom</span> — your enabled built-ins
            don&apos;t match any preset. Pick one above to align, or keep your manual selection.
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`text-xs px-3 py-1.5 rounded border ${
              active
                ? 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40'
                : 'border-bg-border text-text-muted hover:text-text-primary'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RollTypeDescription({ value }: { value: RollTypeFilter }) {
  const text =
    value === 'all-matched'
      ? 'Notify on any drop flagged by an enabled wishlist source.'
      : value === 'strong-pve'
        ? 'Notify only when at least one PVE-tagged source flags the drop.'
        : 'Notify when 2+ enabled sources agree. Strong consensus signal.';
  return <div className="text-xs text-text-muted">{text}</div>;
}

function SoftWarnings({
  sources,
  filterConfig,
}: {
  sources: WishlistSource[];
  filterConfig: WeaponFilterConfig;
}) {
  const warnings: string[] = [];
  if (filterConfig.tierFilter !== 'all' && !hasEnabledTierSource(sources)) {
    warnings.push(
      'Your tier filter requires Aegis-rated wishlists. Enable Aegis Endgame Analysis or Aegis Exclusive below to see tier-filtered notifications.',
    );
  }
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {warnings.map((w, i) => (
        <div
          key={i}
          className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2"
        >
          {w}
        </div>
      ))}
    </div>
  );
}
