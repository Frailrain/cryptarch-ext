// Brief #14.4 — single render component for perk icons. Consumes
// PerkVisualState from the display model; computes no classification of
// its own.
//
// Visual treatment (user preference, supersedes the redesign brief's "ring"
// styling): icons render as-is — no border, no clip-path, no background
// container. Wishlist-tagged perks get a soft gold halo behind/around them
// via layered box-shadows (so the highlight reads as a backlight rather
// than a frame). Untagged-but-rolled perks render at full opacity; perks
// that are neither rolled nor tagged fade to 30% (only visible in the
// expanded perk-pool view).
//
// data-* attributes mirror the booleans so visual state is inspectable
// from the DOM (handy for tests and visual debugging in DevTools).

import type { PerkVisualState } from '@/core/wishlists/perk-visual-state';
import { PerkTooltip } from './PerkTooltip';

export interface PerkIconProps {
  state: PerkVisualState;
  iconUrl: string;
  size: number;
  tooltipText?: string;
}

export function PerkIcon({ state, iconUrl, size, tooltipText }: PerkIconProps) {
  const { isRolledOnGun, isWishlistTagged } = state;
  const isDimmed = !isRolledOnGun && !isWishlistTagged;

  const imgStyle: React.CSSProperties = {
    width: size,
    height: size,
    display: 'block',
    objectFit: 'contain',
    opacity: isDimmed ? 0.3 : 1,
  };
  if (isWishlistTagged) {
    // drop-shadow follows the icon's alpha channel rather than its bounding
    // box, so the glow tracks the actual perk silhouette instead of stamping
    // a square halo around the PNG. Two stacked layers: a tight bright bloom
    // hugging the shape + a wider soft halo for the diffused backlight.
    imgStyle.filter =
      'drop-shadow(0 0 3px rgba(206,174,51,0.85)) drop-shadow(0 0 9px rgba(206,174,51,0.55)) drop-shadow(0 0 14px rgba(206,174,51,0.35))';
  }

  const icon = (
    <span
      className="inline-flex flex-shrink-0"
      data-rolled={isRolledOnGun}
      data-wishlist-tagged={isWishlistTagged}
      style={{ width: size, height: size }}
    >
      <img src={iconUrl} alt="" style={imgStyle} />
    </span>
  );

  if (!tooltipText) return icon;
  return <PerkTooltip text={tooltipText}>{icon}</PerkTooltip>;
}
