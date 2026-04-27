import { describe, expect, it } from 'vitest';
import { classifyPerkVisualState } from './perk-visual-state';

// Identity normalize: most tests don't care about enhanced↔base resolution.
// The two enhanced-perk tests below exercise normalize directly.
const id = (h: number) => h;

describe('classifyPerkVisualState', () => {
  it('rolled + tagged → both flags true, priority 0', () => {
    const result = classifyPerkVisualState({
      perkHash: 100,
      socketIndex: 1,
      unlockedHashesForSocket: [100, 101, 102],
      taggedHashesForSocket: [100],
      normalize: id,
    });
    expect(result).toEqual({
      perkHash: 100,
      normalizedHash: 100,
      socketIndex: 1,
      isRolledOnGun: true,
      isWishlistTagged: true,
      priority: 0,
    });
  });

  it('rolled only → blue flag true, gold false, priority 1', () => {
    const result = classifyPerkVisualState({
      perkHash: 200,
      socketIndex: 2,
      unlockedHashesForSocket: [200, 201],
      taggedHashesForSocket: [999],
      normalize: id,
    });
    expect(result.isRolledOnGun).toBe(true);
    expect(result.isWishlistTagged).toBe(false);
    expect(result.priority).toBe(1);
  });

  it('tagged only → blue false, gold true, priority 2', () => {
    const result = classifyPerkVisualState({
      perkHash: 300,
      socketIndex: 3,
      unlockedHashesForSocket: [],
      taggedHashesForSocket: [300, 301],
      normalize: id,
    });
    expect(result.isRolledOnGun).toBe(false);
    expect(result.isWishlistTagged).toBe(true);
    expect(result.priority).toBe(2);
  });

  it('neither → both flags false, priority 3', () => {
    const result = classifyPerkVisualState({
      perkHash: 400,
      socketIndex: 4,
      unlockedHashesForSocket: [500, 501],
      taggedHashesForSocket: [600, 601],
      normalize: id,
    });
    expect(result.isRolledOnGun).toBe(false);
    expect(result.isWishlistTagged).toBe(false);
    expect(result.priority).toBe(3);
  });

  it('enhanced perk hash in unlocked set, base perk hash in tagged set → classified as both', () => {
    // Bungie enhanced perks live at different hashes than their base
    // versions; the matcher canonicalizes via enhancedPerkMap. The classifier
    // must apply the same normalization so a base-hash tag matches an
    // enhanced-hash drop.
    const ENHANCED = 1000;
    const BASE = 500;
    const normalize = (h: number) => (h === ENHANCED ? BASE : h);
    const result = classifyPerkVisualState({
      perkHash: ENHANCED,
      socketIndex: 3,
      unlockedHashesForSocket: [ENHANCED, ENHANCED + 1],
      taggedHashesForSocket: [BASE],
      normalize,
    });
    expect(result.normalizedHash).toBe(BASE);
    expect(result.isRolledOnGun).toBe(true);
    expect(result.isWishlistTagged).toBe(true);
    expect(result.priority).toBe(0);
  });

  it('base perk hash in unlocked set, enhanced perk hash in tagged set → same outcome', () => {
    // Reverse direction: drop has the base perk, wishlist tagged the
    // enhanced. Symmetric handling — both must end up classified as tagged.
    const ENHANCED = 1000;
    const BASE = 500;
    const normalize = (h: number) => (h === ENHANCED ? BASE : h);
    const result = classifyPerkVisualState({
      perkHash: BASE,
      socketIndex: 3,
      unlockedHashesForSocket: [BASE, BASE + 1],
      taggedHashesForSocket: [ENHANCED],
      normalize,
    });
    expect(result.normalizedHash).toBe(BASE);
    expect(result.isRolledOnGun).toBe(true);
    expect(result.isWishlistTagged).toBe(true);
    expect(result.priority).toBe(0);
  });
});
