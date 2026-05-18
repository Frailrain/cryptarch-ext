import { useCallback, useEffect, useState } from 'react';
import {
  loadCharlesSourceConfig,
  loadWeaponFilterConfig,
  saveCharlesSourceConfig,
  saveWeaponFilterConfig,
} from '@/core/storage/scoring-config';
import { onKeyChanged } from '@/adapters/storage';
import type { CharlesSourceConfig, WeaponFilterConfig } from '@/shared/types';
import { Chip, Headline, SectionHead, Toggle } from '@/components/destiny';
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

  // Brief #25 follow-up: chip clicks are now FILTER-ONLY. They write the
  // updated minTier/PPC to storage and that's it. Scoring reads the latest
  // config from storage when matching drops, applying the filter against
  // the already-parsed wishlist entries in cache.
  //
  // Pre-#25 behavior: each chip click triggered a force-refetch of a
  // config-specific Charles URL (MR{tier}_PPC{ppc}.txt). Rapid clicks
  // chained 6+ fetches × 30 MB each through the SW, each rewriting the
  // ~100 MB `cryptarch:wishlists` blob to chrome.storage.local. The IPC
  // clones for those writes alone could push process memory past 8 GB.
  // Zero network, zero parse on chip click is the fix.
  const updateCharlesConfig = useCallback((next: CharlesSourceConfig) => {
    setCharlesConfig(next);
    saveCharlesSourceConfig(next);
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
      <header className="space-y-1">
        <Headline size="md">Notification Settings</Headline>
        <p className="text-d-11 text-d-text-muted leading-relaxed">
          Configure which drops trigger notifications. Cryptarch alerts you when a
          drop matches your tier and perk criteria below.
        </p>
      </header>

      <div className="space-y-5">
        <div className="space-y-1">
          <Headline size="sm">Aegis weapon coverage</Headline>
          <p className="text-d-11 text-d-text-muted leading-relaxed">
            Pick the tier threshold and how strict you want perk requirements. Brief
            #25.1: switching tier or PPC no longer triggers a refetch — Cryptarch
            caches the full superset and applies these as score-time filters.
          </p>
        </div>

        <ChipRow
          label="Min Tier"
          options={MIN_TIER_OPTIONS}
          value={charlesConfig.minTier}
          onChange={handleMinTierChange}
          helper="Lower tiers include more weapons. F counts every Aegis-rated roll."
        />

        <ChipRow
          label="Perks Per Column"
          options={PPC_OPTIONS}
          value={charlesConfig.ppc}
          onChange={handlePpcChange}
          helper="How many flagged perks must roll to count as a match. 0 = any roll. 3 = strict god rolls only."
        />

        <ToggleRow
          label="Voltron Confirmation"
          checked={filterConfig.voltronConfirmation}
          onChange={handleVoltronToggle}
          helper="Show a thumbs-up when Voltron community keepers also flag the same roll. Confirmation only — Voltron never grades a drop by itself."
        />
      </div>

      {/* Brief #21: WishlistsPanel renders with its own header (Custom GitHub
          repositories) and explanatory text. Built-in source toggles are gone
          — Charles is always primary; Voltron + Choosy Voltron are gated by
          the confirmation toggle above. */}
      <WishlistsPanel />
    </div>
  );
}

function ChipRow<T extends string | number>({
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
    <div className="space-y-2">
      <SectionHead>{label}</SectionHead>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Chip
            key={String(opt.value)}
            active={opt.value === value}
            color="gold"
            onClick={() => onChange(opt.value)}
            className="min-w-[2rem] py-1 justify-center"
          >
            {opt.label}
          </Chip>
        ))}
      </div>
      {helper && (
        <div className="text-d-10 text-d-text-muted leading-relaxed">{helper}</div>
      )}
    </div>
  );
}

function ToggleRow({
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <SectionHead>{label}</SectionHead>
        <Toggle on={checked} onToggle={() => onChange(!checked)} ariaLabel={label} />
      </div>
      {helper && (
        <div className="text-d-10 text-d-text-muted leading-relaxed">{helper}</div>
      )}
    </div>
  );
}
