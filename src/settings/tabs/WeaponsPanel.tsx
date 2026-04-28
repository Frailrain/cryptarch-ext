import { useCallback, useEffect, useState } from 'react';
import {
  loadCharlesSourceConfig,
  loadWeaponFilterConfig,
  saveCharlesSourceConfig,
  saveWeaponFilterConfig,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
import { requestRefreshOne } from '@/adapters/wishlist-messages';
import { CHARLES_SOURCE_ID } from '@/core/wishlists/known-sources';
import type { CharlesSourceConfig, WeaponFilterConfig } from '@/shared/types';
import { WishlistsPanel } from './WishlistsPanel';

// Brief #19. The Weapons tab is the user's "what to be notified about" surface.
// Charles's two-axis selector (minTier S-F + perks-per-column 0-3) drives the
// active wishlist URL; lower-priority "manage individual sources" stays below
// for power users who want to enable Voltron, deprecated Aegis sources, or
// custom URLs.
//
// The selector swaps the active Charles file dynamically. Each change writes
// charlesSourceConfig and triggers a force-refetch of the Charles source so
// the new file's contents land in the wishlist cache before the next drop is
// scored. Old config's parsed entries are dropped — no per-config caching in
// this brief; toggling between configs costs another fetch each time.

const MIN_TIER_OPTIONS: { value: CharlesSourceConfig['minTier']; label: string }[] = [
  { value: 'S', label: 'S' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
  { value: 'F', label: 'F' },
];

const PPC_OPTIONS: { value: CharlesSourceConfig['ppc']; label: string }[] = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];

export function WeaponsPanel() {
  const [charlesConfig, setCharlesConfig] = useState<CharlesSourceConfig>(() =>
    loadCharlesSourceConfig(),
  );
  const [filterConfig, setFilterConfig] = useState<WeaponFilterConfig>(() =>
    loadWeaponFilterConfig(),
  );

  useEffect(() => {
    const unsub1 = onKeyChanged<CharlesSourceConfig>('charlesSourceConfig', (v) => {
      if (v) setCharlesConfig(v);
    });
    const unsub2 = onKeyChanged<WeaponFilterConfig>('weaponFilterConfig', (v) => {
      if (v) setFilterConfig(v);
    });
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  // Persist Charles config and force a refetch of the Charles source. The
  // SW's URL-from-config injection means refresh hits the new MR{tier}_PPC{n}
  // file; no cache-key gymnastics needed here. Force=true skips the 24h
  // staleness window so the swap takes effect immediately.
  const updateCharlesConfig = useCallback((next: CharlesSourceConfig) => {
    setCharlesConfig(next);
    saveCharlesSourceConfig(next);
    void requestRefreshOne(CHARLES_SOURCE_ID, true);
  }, []);

  const updateFilterConfig = useCallback((next: WeaponFilterConfig) => {
    setFilterConfig(next);
    saveWeaponFilterConfig(next);
  }, []);

  const handleMinTierChange = useCallback(
    (minTier: CharlesSourceConfig['minTier']) => {
      updateCharlesConfig({ ...charlesConfig, minTier });
    },
    [charlesConfig, updateCharlesConfig],
  );

  const handlePpcChange = useCallback(
    (ppc: CharlesSourceConfig['ppc']) => {
      updateCharlesConfig({ ...charlesConfig, ppc });
    },
    [charlesConfig, updateCharlesConfig],
  );

  const handleVoltronToggle = useCallback(
    (voltronConfirmation: boolean) => {
      updateFilterConfig({ ...filterConfig, voltronConfirmation });
    },
    [filterConfig, updateFilterConfig],
  );

  return (
    <div className="space-y-6">
      {/* Brief #21: top-of-tab header. Cryptarch's appraiser uses Charles's
          Aegis tier export as primary; Voltron community keepers serve as
          confirmation when the toggle below is on. The selector controls
          which Charles file is active (tier coverage + perk strictness). */}
      <header className="space-y-1 px-1">
        <h2 className="text-lg font-semibold text-text-primary">Notification Settings</h2>
        <p className="text-sm text-text-muted">
          Configure which drops trigger notifications. Cryptarch alerts you when a
          drop matches your tier and perk criteria below.
        </p>
      </header>

      <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Aegis weapon coverage</h2>
          <p className="text-sm text-text-muted">
            Pick the tier threshold and how strict you want perk requirements. The
            Charles wishlist swaps to the matching variant automatically; switching
            tiers or perk strictness re-fetches the corresponding file (~15s the
            first time for each combination).
          </p>
        </div>

        <PillRadioGroup
          label="Min Tier"
          options={MIN_TIER_OPTIONS}
          value={charlesConfig.minTier}
          onChange={handleMinTierChange}
          helper="Lower tiers include more weapons. F shows everything Aegis rated."
        />

        <PillRadioGroup
          label="Perks Per Column"
          options={PPC_OPTIONS}
          value={charlesConfig.ppc}
          onChange={handlePpcChange}
          helper="How many flagged perks must roll to count as a match. 0 = any roll. 3 = strict god rolls only."
        />

        <Checkbox
          label="Show thumbs-up when Voltron also flags this roll"
          checked={filterConfig.voltronConfirmation}
          onChange={handleVoltronToggle}
          helper="Voltron is a community-curated keeper list. When both Aegis and Voltron agree, the drop gets an extra confirmation indicator. (Visual treatment lands in a follow-up brief.)"
        />
      </div>

      {/* Brief #21: WishlistsPanel renders with its own header (Custom
          GitHub repositories) and explanatory text. Built-in source toggles
          are gone — Charles is always primary, Voltron + Choosy Voltron are
          gated by the confirmation toggle above, deprecated Aegis sources
          stay disabled. */}
      <WishlistsPanel />
    </div>
  );
}

function PillRadioGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  helper,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  helper?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-text-muted">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              onClick={() => onChange(opt.value)}
              className={`text-xs px-3 py-1.5 rounded border min-w-[2.5rem] ${
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
      {helper && <div className="text-xs text-text-muted">{helper}</div>}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  helper,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  helper?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-rahool-blue cursor-pointer"
        />
        <span className="text-sm text-text-primary">{label}</span>
      </label>
      {helper && <div className="text-xs text-text-muted ml-6">{helper}</div>}
    </div>
  );
}
