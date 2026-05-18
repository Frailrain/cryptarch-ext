import { describe, expect, it } from 'vitest';
import { computeCharlesUrl } from './known-sources';

// Brief #25.1: computeCharlesUrl no longer maps config → tier-specific URL.
// The minTier+PPC selectors became score-time filters (see matcher.ts), and
// the Charles source always fetches the MRF_PPC0 superset. These tests pin
// the new behavior so a future change can't silently re-introduce the
// per-config URL pattern that drove the memory issue in Brief #25.
describe('computeCharlesUrl', () => {
  const SUPERSET =
    'https://raw.githubusercontent.com/charlesxcaliber/DIMAegisWeaponWishlist/main/MrCharlesWishlist_MRF_PPC0.txt';

  it('returns the MRF_PPC0 superset URL by default', () => {
    expect(computeCharlesUrl({ minTier: 'F', ppc: 0 })).toBe(SUPERSET);
  });

  it('returns the same URL regardless of selected minTier', () => {
    expect(computeCharlesUrl({ minTier: 'S', ppc: 0 })).toBe(SUPERSET);
    expect(computeCharlesUrl({ minTier: 'C', ppc: 0 })).toBe(SUPERSET);
  });

  it('returns the same URL regardless of selected PPC', () => {
    expect(computeCharlesUrl({ minTier: 'A', ppc: 3 })).toBe(SUPERSET);
  });

  it('returns the same URL across any minTier+PPC combination', () => {
    expect(computeCharlesUrl({ minTier: 'B', ppc: 2 })).toBe(SUPERSET);
    expect(computeCharlesUrl({ minTier: 'D', ppc: 1 })).toBe(SUPERSET);
  });
});
