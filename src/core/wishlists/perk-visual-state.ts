// Brief #14.4 — single source of truth for per-perk visual classification.
// All three render paths (collapsed Drop Log row, popup row, expanded view)
// derive their visual treatment exclusively from this module. The two
// independent visual channels are:
//
//   isRolledOnGun     → blue tinted background
//   isWishlistTagged  → gold border
//
// Render code applies them as independent class clauses. There is no
// "matched column" or "good column" abstraction; treatments are per-icon.
// Priority field exists to drive the expanded view's left-to-right ordering
// (rolled+tagged → rolled+untagged → tagged-unrolled → neither).
//
// Pure module: no React, no Tailwind, no I/O. Test from ./perk-visual-state.test.ts.

export interface PerkVisualState {
  perkHash: number;
  normalizedHash: number;
  socketIndex: number;
  isRolledOnGun: boolean;
  isWishlistTagged: boolean;
  priority: 0 | 1 | 2 | 3;
}

export function classifyPerkVisualState(args: {
  perkHash: number;
  socketIndex: number;
  unlockedHashesForSocket: readonly number[];
  taggedHashesForSocket: readonly number[];
  normalize: (hash: number) => number;
}): PerkVisualState {
  const normalizedHash = args.normalize(args.perkHash);

  // Normalize both sides of every comparison so a base-vs-enhanced mismatch
  // never produces a false negative. Cheap — these arrays are typically
  // 1-12 entries.
  const isRolledOnGun = args.unlockedHashesForSocket.some(
    (h) => args.normalize(h) === normalizedHash,
  );
  const isWishlistTagged = args.taggedHashesForSocket.some(
    (h) => args.normalize(h) === normalizedHash,
  );

  const priority: 0 | 1 | 2 | 3 = isRolledOnGun
    ? isWishlistTagged
      ? 0
      : 1
    : isWishlistTagged
      ? 2
      : 3;

  return {
    perkHash: args.perkHash,
    normalizedHash,
    socketIndex: args.socketIndex,
    isRolledOnGun,
    isWishlistTagged,
    priority,
  };
}
