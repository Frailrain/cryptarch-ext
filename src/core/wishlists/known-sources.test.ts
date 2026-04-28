import { describe, expect, it } from 'vitest';
import { computeCharlesUrl } from './known-sources';

describe('computeCharlesUrl', () => {
  const BASE = 'https://raw.githubusercontent.com/charlesxcaliber/DIMAegisWeaponWishlist/main/';

  it('builds the default MRF_PPC0 URL', () => {
    expect(computeCharlesUrl({ minTier: 'F', ppc: 0 })).toBe(
      `${BASE}MrCharlesWishlist_MRF_PPC0.txt`,
    );
  });

  it('inserts the selected tier letter into MR{X}', () => {
    expect(computeCharlesUrl({ minTier: 'S', ppc: 0 })).toBe(
      `${BASE}MrCharlesWishlist_MRS_PPC0.txt`,
    );
    expect(computeCharlesUrl({ minTier: 'C', ppc: 0 })).toBe(
      `${BASE}MrCharlesWishlist_MRC_PPC0.txt`,
    );
  });

  it('inserts PPC into the suffix', () => {
    expect(computeCharlesUrl({ minTier: 'A', ppc: 3 })).toBe(
      `${BASE}MrCharlesWishlist_MRA_PPC3.txt`,
    );
  });

  it('combines both axes for any of the 28 valid combinations', () => {
    expect(computeCharlesUrl({ minTier: 'B', ppc: 2 })).toBe(
      `${BASE}MrCharlesWishlist_MRB_PPC2.txt`,
    );
    expect(computeCharlesUrl({ minTier: 'D', ppc: 1 })).toBe(
      `${BASE}MrCharlesWishlist_MRD_PPC1.txt`,
    );
  });
});
