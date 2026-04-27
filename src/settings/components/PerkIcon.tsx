// Brief #14.4 — single render component for perk icons. Consumes
// PerkVisualState from the display model; computes no classification of
// its own. Two independent visual channels:
//
//   isRolledOnGun     → blue tinted background  (rolledBackgroundClasses)
//   isWishlistTagged  → gold border + glow      (wishlistBorderClasses)
//
// They apply via independent class clauses with no nested ternaries; a perk
// that is both rolled and tagged stacks both treatments. Untagged-and-not-
// rolled perks are dimmed (the "missed filler" case in expanded view).
//
// Background tint goes on the wrapper, not the inner image — the image is
// sized smaller than the wrapper so the tint shows through around the
// edges. Don't change that without verifying the tint stays visible.
//
// data-* attributes mirror the booleans so visual state is inspectable
// from the DOM (handy for tests and for visual debugging in DevTools).

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

  const wrapperStyle: React.CSSProperties = {
    width: size,
    height: size,
  };
  if (isRolledOnGun) {
    wrapperStyle.background = 'rgba(127, 179, 213, 0.15)';
  }
  if (isWishlistTagged) {
    wrapperStyle.border = '2px solid #D4A82C';
    wrapperStyle.boxShadow = '0 0 4px rgba(212, 168, 44, 0.4)';
  }
  if (isDimmed) {
    wrapperStyle.opacity = 0.4;
  }

  // The inner image is sized smaller than the wrapper so the wrapper's
  // background tint is visible around its edges. Without this margin the
  // image fully covers the wrapper and the blue tint disappears.
  const innerSize = isWishlistTagged ? size - 4 : size - 2;

  const icon = (
    <span
      className="inline-flex items-center justify-center rounded flex-shrink-0"
      data-rolled={isRolledOnGun}
      data-wishlist-tagged={isWishlistTagged}
      style={wrapperStyle}
    >
      <img
        src={iconUrl}
        alt=""
        className="rounded"
        style={{ width: innerSize, height: innerSize }}
      />
    </span>
  );

  if (!tooltipText) return icon;
  return <PerkTooltip text={tooltipText}>{icon}</PerkTooltip>;
}
