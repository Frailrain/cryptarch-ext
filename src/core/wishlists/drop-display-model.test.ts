import { describe, expect, it } from 'vitest';
import {
  buildDropPerkDisplayModel,
  selectCollapsedPerk,
  voltronConfirmedFromMatches,
} from './drop-display-model';
import type { PerkVisualState } from './perk-visual-state';
import type { DropFeedEntry, WishlistMatch } from '@/shared/types';
import type { WeaponPerkPoolSnapshot } from '@/core/bungie/perk-pool-cache';

const id = (h: number) => h;

function makeState(overrides: Partial<PerkVisualState>): PerkVisualState {
  return {
    perkHash: 0,
    normalizedHash: 0,
    socketIndex: 0,
    isRolledOnGun: false,
    isWishlistTagged: false,
    priority: 3,
    ...overrides,
  };
}

describe('voltronConfirmedFromMatches', () => {
  it('returns false for undefined / empty input', () => {
    expect(voltronConfirmedFromMatches(undefined)).toBe(false);
    expect(voltronConfirmedFromMatches([])).toBe(false);
  });

  it('returns false when no match has confirmsCharles', () => {
    expect(
      voltronConfirmedFromMatches([
        { sourceId: 'voltron', sourceName: 'Voltron' },
        { sourceId: 'charles-aegis-tiered', sourceName: 'Aegis Tiered (Charles)' },
      ]),
    ).toBe(false);
  });

  it('returns true when at least one match has confirmsCharles=true', () => {
    expect(
      voltronConfirmedFromMatches([
        { sourceId: 'charles-aegis-tiered', sourceName: 'Aegis Tiered (Charles)' },
        {
          sourceId: 'voltron',
          sourceName: 'Voltron',
          confirmsCharles: true,
        },
      ]),
    ).toBe(true);
  });

  it('treats confirmsCharles=false the same as missing', () => {
    expect(
      voltronConfirmedFromMatches([
        {
          sourceId: 'voltron',
          sourceName: 'Voltron',
          confirmsCharles: false,
        },
      ]),
    ).toBe(false);
  });
});

describe('selectCollapsedPerk', () => {
  it('three rolled perks where one is tagged → returns the tagged one', () => {
    const perks = [
      makeState({ perkHash: 100, isRolledOnGun: true, isWishlistTagged: false }),
      makeState({ perkHash: 200, isRolledOnGun: true, isWishlistTagged: true }),
      makeState({ perkHash: 300, isRolledOnGun: true, isWishlistTagged: false }),
    ];
    expect(selectCollapsedPerk(perks)?.perkHash).toBe(200);
  });

  it('three rolled perks none tagged → returns the first in stable order', () => {
    const perks = [
      makeState({ perkHash: 100, isRolledOnGun: true }),
      makeState({ perkHash: 200, isRolledOnGun: true }),
      makeState({ perkHash: 300, isRolledOnGun: true }),
    ];
    expect(selectCollapsedPerk(perks)?.perkHash).toBe(100);
  });

  it('no rolled perks → returns undefined', () => {
    const perks = [
      makeState({ perkHash: 100, isRolledOnGun: false }),
      makeState({ perkHash: 200, isRolledOnGun: false }),
    ];
    expect(selectCollapsedPerk(perks)).toBeUndefined();
  });
});

// Synanceia regression fixture: the bug that triggered Brief #14.4. A
// 5-column weapon where some columns had wishlist-tagged perks rolled and
// others didn't. The collapsed-row render computed visual treatment
// independently and got it wrong: tagged columns lost the gold border, or
// untagged columns gained one. The display model must produce
// isWishlistTagged correctly per column.
describe('buildDropPerkDisplayModel — Synanceia regression', () => {
  const snapshot: WeaponPerkPoolSnapshot = {
    weaponHash: 9999,
    manifestVersion: 'test-manifest-v1',
    resolvedAt: '2026-04-27T00:00:00Z',
    columns: [
      // socketIndex 1: barrel — rolled with tagged perk (Hammer-Forged)
      {
        socketIndex: 1,
        label: 'Barrel',
        plugs: [
          { hash: 1001, name: 'Hammer-Forged', iconUrl: 'icon1', description: '' },
          { hash: 1002, name: 'Smallbore', iconUrl: 'icon2', description: '' },
        ],
      },
      // socketIndex 2: magazine — rolled with untagged perk
      {
        socketIndex: 2,
        label: 'Magazine',
        plugs: [
          { hash: 2001, name: 'Tactical Mag', iconUrl: 'icon3', description: '' },
          { hash: 2002, name: 'High-Caliber', iconUrl: 'icon4', description: '' },
        ],
      },
      // socketIndex 3: trait 1 — rolled with tagged perk (Outlaw)
      {
        socketIndex: 3,
        label: 'Trait 1',
        plugs: [
          { hash: 3001, name: 'Outlaw', iconUrl: 'icon5', description: '' },
          { hash: 3002, name: 'Threat Detector', iconUrl: 'icon6', description: '' },
        ],
      },
      // socketIndex 4: trait 2 — rolled with untagged perk
      {
        socketIndex: 4,
        label: 'Trait 2',
        plugs: [
          { hash: 4001, name: 'Rampage', iconUrl: 'icon7', description: '' },
          { hash: 4002, name: 'Kill Clip', iconUrl: 'icon8', description: '' },
        ],
      },
      // socketIndex 5: origin trait — rolled with tagged perk (Souldrinker)
      {
        socketIndex: 5,
        label: 'Origin Trait',
        plugs: [
          { hash: 5001, name: 'Souldrinker', iconUrl: 'icon9', description: '' },
          { hash: 5002, name: 'Nadir Focus', iconUrl: 'icon10', description: '' },
        ],
      },
    ],
  };

  // Wishlist tags: Hammer-Forged barrel, Outlaw trait, Souldrinker origin.
  const wishlistMatches: WishlistMatch[] = [
    {
      sourceId: 'aegis',
      sourceName: 'Aegis',
      taggedPerkHashes: [1001, 3001, 5001],
    },
  ];

  // Entry: rolled the Hammer-Forged + Tactical Mag + Outlaw + Rampage +
  // Souldrinker. So columns 1, 3, 5 should be tagged in collapsed view;
  // columns 2, 4 should not be.
  const entry: DropFeedEntry = {
    instanceId: 'drop-syn-1',
    itemHash: 9999,
    itemName: 'Synanceia',
    itemIcon: 'weaponIcon',
    itemType: 'weapon',
    timestamp: 0,
    locked: false,
    perkIcons: ['icon1', 'icon3', 'icon5', 'icon7', 'icon9'],
    perkHashes: [1001, 2001, 3001, 4001, 5001],
    unlockedPerksBySocketIndex: {
      1: [1001],
      2: [2001],
      3: [3001],
      4: [4001],
      5: [5001],
    },
    weaponType: 'Trace Rifle',
    armorMatched: null,
    armorClass: null,
    armorSet: null,
    armorArchetype: null,
    armorTertiary: null,
    armorTier: null,
    isExotic: false,
  };

  it('tagged columns have isWishlistTagged=true on collapsed perk', () => {
    const model = buildDropPerkDisplayModel({
      entry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const bySocket = new Map(model.map((c) => [c.socketIndex, c]));
    expect(bySocket.get(1)?.collapsedPerk?.isWishlistTagged).toBe(true);
    expect(bySocket.get(3)?.collapsedPerk?.isWishlistTagged).toBe(true);
    expect(bySocket.get(5)?.collapsedPerk?.isWishlistTagged).toBe(true);
  });

  it('untagged columns have isWishlistTagged=false on collapsed perk', () => {
    const model = buildDropPerkDisplayModel({
      entry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const bySocket = new Map(model.map((c) => [c.socketIndex, c]));
    expect(bySocket.get(2)?.collapsedPerk?.isWishlistTagged).toBe(false);
    expect(bySocket.get(4)?.collapsedPerk?.isWishlistTagged).toBe(false);
  });

  it('every collapsed perk has isRolledOnGun=true', () => {
    const model = buildDropPerkDisplayModel({
      entry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    for (const col of model) {
      expect(col.collapsedPerk?.isRolledOnGun).toBe(true);
    }
  });

  it('expanded view sorts by priority (rolled+tagged first, then rolled, then tagged-unrolled, then neither)', () => {
    const model = buildDropPerkDisplayModel({
      entry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const trait1 = model.find((c) => c.socketIndex === 3);
    expect(trait1?.expandedPerks.map((p) => p.state.priority)).toEqual([0, 3]);
    // Confirm Outlaw (rolled+tagged, hash 3001) is first.
    expect(trait1?.expandedPerks[0].state.perkHash).toBe(3001);
  });

  it('legacy entry without unlockedPerksBySocketIndex falls back to perkHashes positionally', () => {
    const legacyEntry: DropFeedEntry = {
      ...entry,
      // Drop the new-shape field; rely on legacy parallel-array fallback.
      unlockedPerksBySocketIndex: undefined,
      perkHashes: [1001, 2001, 3001, 4001, 5001],
    };
    const model = buildDropPerkDisplayModel({
      entry: legacyEntry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const bySocket = new Map(model.map((c) => [c.socketIndex, c]));
    // Same expected outcome as the new-shape entry — fallback realigns by
    // position within snapshot.columns.
    expect(bySocket.get(1)?.collapsedPerk?.isWishlistTagged).toBe(true);
    expect(bySocket.get(2)?.collapsedPerk?.isWishlistTagged).toBe(false);
    expect(bySocket.get(3)?.collapsedPerk?.isWishlistTagged).toBe(true);
    expect(bySocket.get(4)?.collapsedPerk?.isWishlistTagged).toBe(false);
    expect(bySocket.get(5)?.collapsedPerk?.isWishlistTagged).toBe(true);
  });

  it('snapshotless render (no snapshot) classifies entry perkHashes against flat tagged set', () => {
    const model = buildDropPerkDisplayModel({
      entry,
      wishlistMatches,
      normalize: id,
    });
    expect(model).toHaveLength(5);
    // Tagged columns (1, 3, 5 in the entry by parallel-index) should have
    // gold, untagged columns (indexes 1, 3 → wait, careful: perkHashes
    // index, not socket index — perkHashes[0]=1001 tagged, [1]=2001 not).
    expect(model[0].collapsedPerk?.isWishlistTagged).toBe(true); // 1001
    expect(model[1].collapsedPerk?.isWishlistTagged).toBe(false); // 2001
    expect(model[2].collapsedPerk?.isWishlistTagged).toBe(true); // 3001
    expect(model[3].collapsedPerk?.isWishlistTagged).toBe(false); // 4001
    expect(model[4].collapsedPerk?.isWishlistTagged).toBe(true); // 5001
    for (const col of model) {
      expect(col.collapsedPerk?.isRolledOnGun).toBe(true);
      expect(col.expandedPerks).toEqual([]);
    }
  });

  it('weaponGodrollHashes (Brief #14.5) gold-borders perks the user did NOT roll', () => {
    // The entry's matched roll has [1001, 3001, 5001] tagged via Aegis.
    // weaponGodrollHashes adds two perks the user didn't roll but Aegis
    // flagged as godrolls in OTHER entries for this weapon: 3002 (a
    // different Trait 1 godroll the user missed) and 4002 (a Trait 2
    // godroll). Those should now show as missed-keepers (gold border, no
    // blue background) in the expanded view.
    const entryWithUnion: DropFeedEntry = {
      ...entry,
      weaponGodrollHashes: [1001, 3001, 5001, 3002, 4002],
    };
    const model = buildDropPerkDisplayModel({
      entry: entryWithUnion,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const trait1 = model.find((c) => c.socketIndex === 3);
    const trait2 = model.find((c) => c.socketIndex === 4);
    // Trait 1 column: rolled keeper (3001) at priority 0, missed keeper
    // (3002) at priority 2.
    const trait1Plug3002 = trait1?.expandedPerks.find((p) => p.state.perkHash === 3002);
    expect(trait1Plug3002?.state.isWishlistTagged).toBe(true);
    expect(trait1Plug3002?.state.isRolledOnGun).toBe(false);
    // Trait 2 column: rolled (4001, untagged) at priority 1, missed
    // keeper (4002) at priority 2.
    const trait2Plug4002 = trait2?.expandedPerks.find((p) => p.state.perkHash === 4002);
    expect(trait2Plug4002?.state.isWishlistTagged).toBe(true);
    expect(trait2Plug4002?.state.isRolledOnGun).toBe(false);
  });

  it('crafted weapon: column with multiple unlocked perks where one is tagged → collapsed picks tagged', () => {
    const craftedEntry: DropFeedEntry = {
      ...entry,
      unlockedPerksBySocketIndex: {
        1: [1001],
        2: [2001],
        // Trait 1: user has both Outlaw (tagged) and Threat Detector unlocked.
        // Currently equipped is Threat Detector (perkHashes[2]=3002), but the
        // collapsed perk should still surface Outlaw because it's the
        // wishlist pick and the user can swap to it.
        3: [3001, 3002],
        4: [4001],
        5: [5001],
      },
      perkHashes: [1001, 2001, 3002, 4001, 5001],
      perkIcons: ['icon1', 'icon3', 'icon6', 'icon7', 'icon9'],
    };
    const model = buildDropPerkDisplayModel({
      entry: craftedEntry,
      snapshot,
      wishlistMatches,
      normalize: id,
    });
    const trait1 = model.find((c) => c.socketIndex === 3);
    expect(trait1?.collapsedPerk?.perkHash).toBe(3001);
    expect(trait1?.collapsedPerk?.isWishlistTagged).toBe(true);
  });
});
