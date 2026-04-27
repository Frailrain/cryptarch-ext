// Brief #14.2 Part B — collapsed-row rolled-perk display, shared by the
// dashboard Drop Log row and the popup row. One icon per actually-rolled
// perk column, treatment encoded per perk:
//
//   Rolled keeper (rolled + wishlist-tagged):
//     blue tint background, gold border, glow, full opacity
//   Rolled filler (rolled + not tagged, OR exotic w/ no random rolls):
//     near-black background, gold border, no glow, 0.65 opacity
//   Legacy (entry has no itemHash — pre-Brief #14):
//     unstyled icons, current pre-#14 treatment. The "tagged vs filler"
//     distinction needs perk-pool data we don't have for legacy entries.
//
// The popup variant uses smaller icons (22px) than the dashboard (28px) to
// fit the popup's denser row layout — same treatments otherwise.

import type { DropFeedEntry } from '@/shared/types';
import { getPerkName } from '@/adapters/perk-pool-messages';

// Hover tooltip text for a perk. Falls back to the canonical hash when the
// page-side name cache hasn't seen this perk yet — tooltips populate as the
// idle prewarm and expand-on-click fetches land. Don't trigger a fetch on
// render; we settle for the hash if nothing else.
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
  const isLegacy = entry.itemHash === undefined;
  // Exotics don't have random rolls, so every rolled perk is treated as
  // filler ("yours, not wishlist-evaluable"). Same gold-border, dim, no
  // glow as a normal weapon's rolled filler.
  const isExoticForceFiller = entry.isExotic;

  const tagged = new Set<number>();
  if (!isLegacy && !isExoticForceFiller) {
    for (const m of entry.wishlistMatches ?? []) {
      for (const h of m.taggedPerkHashes ?? []) tagged.add(h);
    }
  }

  if (entry.perkIcons.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {entry.perkIcons.map((icon, i) => {
        const hash = entry.perkHashes?.[i] ?? -1;
        const tooltip = perkLabel(hash);
        if (isLegacy) {
          return (
            <img
              key={i}
              src={icon}
              alt=""
              title={tooltip || undefined}
              className="rounded"
              style={{ width: iconSize, height: iconSize }}
            />
          );
        }
        const isKeeper = !isExoticForceFiller && tagged.has(hash);
        return (
          <PerkSlot
            key={i}
            iconUrl={icon}
            tooltip={tooltip}
            kind={isKeeper ? 'rolled-keeper' : 'rolled-filler'}
            size={iconSize}
          />
        );
      })}
    </div>
  );
}

function PerkSlot({
  iconUrl,
  tooltip,
  kind,
  size,
}: {
  iconUrl: string;
  tooltip: string;
  kind: 'rolled-keeper' | 'rolled-filler';
  size: number;
}) {
  // Inline styles for the spec'd exact values (gold #D4A82C / blue tint at
  // 15% / near-black #1a1a1a). rahool-yellow / rahool-blue tokens align with
  // the spec but the box-shadow glow needs an arbitrary color anyway.
  const isKeeper = kind === 'rolled-keeper';
  const style: React.CSSProperties = {
    width: size,
    height: size,
    border: '2px solid #D4A82C',
    background: isKeeper ? 'rgba(127, 179, 213, 0.15)' : '#1a1a1a',
    boxShadow: isKeeper ? '0 0 4px rgba(212, 168, 44, 0.4)' : undefined,
    opacity: isKeeper ? 1 : 0.65,
  };
  return (
    <span
      title={tooltip || undefined}
      className="inline-flex items-center justify-center rounded"
      style={style}
    >
      <img
        src={iconUrl}
        alt=""
        className="rounded"
        style={{ width: size - 4, height: size - 4 }}
      />
    </span>
  );
}
