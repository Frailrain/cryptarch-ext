// Brief #14.4 — collapsed-row rolled-perk display, shared by the dashboard
// Drop Log row and the popup row. Renders the display model produced by
// buildDropPerkDisplayModel. Contains zero direct visual logic; the
// PerkIcon component applies treatments based on PerkVisualState alone.
//
// The model is built without a snapshot here (snapshot=undefined) because
// the collapsed row needs to render before the SW responds. The
// snapshotless path classifies entry.perkHashes against the wishlist's
// flat tagged set — same per-column outcome as the with-snapshot path
// because perks are unique to columns in practice.
//
// Legacy entries (no perkHashes / no itemHash) gracefully degrade: the
// builder produces no columns, this component renders the unstyled
// perkIcons array as a fallback. Pre-Brief-#14 entries still display the
// rolled-perk icons even without classification data.
//
// The popup variant uses smaller icons (22px) than the dashboard (28px).

import { useEffect, useReducer } from 'react';
import type { DropFeedEntry } from '@/shared/types';
import { getPerkName, subscribePerkNames } from '@/adapters/perk-pool-messages';
import { buildDropPerkDisplayModel } from '@/core/wishlists/drop-display-model';
import { PerkIcon } from './PerkIcon';
import { PerkTooltip } from './PerkTooltip';

// Re-render this row whenever the perk name cache gains new entries — so
// tooltips populate after the prewarm response lands.
function usePerkNamesVersion() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribePerkNames(bump), []);
}

function perkLabel(hash: number): string {
  if (hash === -1) return '';
  return getPerkName(hash) ?? `Perk #${hash}`;
}

export function RolledPerkRow({
  entry,
  iconSize = 28,
}: {
  entry: DropFeedEntry;
  iconSize?: number;
}) {
  usePerkNamesVersion();
  if (entry.perkIcons.length === 0) return null;

  // Pre-Brief #14 entries lack perkHashes entirely. Render unstyled icons
  // (no classification possible without hash data); same visual as the
  // pre-#14 era so legacy rows don't regress.
  if (!entry.perkHashes) {
    return (
      <div className="flex items-center gap-1">
        {entry.perkIcons.map((icon, i) => (
          <PerkTooltip key={i} text="">
            <img
              src={icon}
              alt=""
              className="rounded"
              style={{ width: iconSize, height: iconSize }}
            />
          </PerkTooltip>
        ))}
      </div>
    );
  }

  const model = buildDropPerkDisplayModel({
    entry,
    wishlistMatches: entry.wishlistMatches ?? [],
    normalize: (h) => h,
  });

  return (
    <div className="flex items-center gap-1">
      {model.map((col, i) => {
        if (!col.collapsedPerk || !col.collapsedIconUrl) return null;
        return (
          <PerkIcon
            key={col.socketIndex ?? i}
            state={col.collapsedPerk}
            iconUrl={col.collapsedIconUrl}
            size={iconSize}
            tooltipText={perkLabel(col.collapsedPerk.normalizedHash)}
          />
        );
      })}
    </div>
  );
}
