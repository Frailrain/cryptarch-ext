// Mocked Destiny 2 drop data with LOCAL icon paths.
// Weapon icons and perk icons are canvas-drawn D2-style PNGs in assets/icons/.

const P = '../../assets/icons/';

const PERK = {
  slideshot:      P + 'perk-slideshot.png',
  killClip:       P + 'perk-kill-clip.png',
  reconstruction: P + 'perk-reconstruction.png',
  trenchBarrel:   P + 'perk-trench-barrel.png',
  vorpal:         P + 'perk-vorpal.png',
  rampage:        P + 'perk-rampage.png',
  outlaw:         P + 'perk-outlaw.png',
  fieldPrep:      P + 'perk-field-prep.png',
  surrounded:     P + 'perk-surrounded.png',
  surplus:        P + 'perk-surplus.png',
  whirlwind:      P + 'perk-whirlwind.png',
  relentless:     P + 'perk-relentless.png',
};

const SAMPLE_DROPS = [
  {
    id: 'd1', t: 2 * 60 * 1000, type: 'weapon', name: 'Heritage',
    sub: 'Slug Shotgun · Kinetic', grade: 'god', tier: 'S',
    isExotic: false, locked: true,
    icon: P + 'heritage.png',
    perks: [
      { icon: PERK.slideshot, rolled: true, tagged: true },
      { icon: PERK.fieldPrep, rolled: true, tagged: false },
      { icon: PERK.trenchBarrel, rolled: true, tagged: true },
      { icon: PERK.reconstruction, rolled: true, tagged: false },
    ],
    pool: [
      [{ icon: PERK.slideshot, tagged: true },  { icon: PERK.surplus, tagged: false },  { icon: PERK.fieldPrep, tagged: false }, { icon: PERK.outlaw, tagged: false }],
      [{ icon: PERK.fieldPrep, tagged: false },  { icon: PERK.killClip, tagged: false }, { icon: PERK.rampage, tagged: false },  { icon: PERK.surrounded, tagged: false }],
      [{ icon: PERK.trenchBarrel, tagged: true },{ icon: PERK.vorpal, tagged: true },    { icon: PERK.whirlwind, tagged: false },{ icon: PERK.relentless, tagged: false }],
      [{ icon: PERK.reconstruction, tagged: false },{ icon: PERK.rampage, tagged: true },{ icon: PERK.outlaw, tagged: false },   { icon: PERK.surplus, tagged: false }],
    ],
    sources: ['Aegis Endgame', 'Voltron'],
  },
  {
    id: 'd2', t: 14 * 60 * 1000, type: 'armor', name: 'Necrotic Grip',
    sub: 'Warlock · Sundered · Brawler · T5', grade: 'exotic',
    isExotic: true, locked: false, perks: [], sources: [],
    icon: P + 'necrotic-grip.png',
  },
  {
    id: 'd3', t: 27 * 60 * 1000, type: 'weapon', name: 'Falling Guillotine',
    sub: 'Sword · Heavy · Void', grade: 'keep', tier: 'A',
    isExotic: false, locked: false,
    icon: P + 'falling-guillotine.png',
    perks: [
      { icon: PERK.relentless, rolled: true, tagged: true },
      { icon: PERK.surrounded, rolled: true, tagged: false },
      { icon: PERK.whirlwind, rolled: true, tagged: true },
      { icon: PERK.rampage, rolled: true, tagged: false },
    ],
    pool: [
      [{ icon: PERK.relentless, tagged: true }, { icon: PERK.surplus, tagged: false },  { icon: PERK.outlaw, tagged: false }],
      [{ icon: PERK.surrounded, tagged: false },{ icon: PERK.fieldPrep, tagged: false },{ icon: PERK.killClip, tagged: false }],
      [{ icon: PERK.whirlwind, tagged: true },  { icon: PERK.vorpal, tagged: false },   { icon: PERK.trenchBarrel, tagged: true }],
      [{ icon: PERK.rampage, tagged: false },    { icon: PERK.slideshot, tagged: false },{ icon: PERK.reconstruction, tagged: false }],
    ],
    sources: ['Aegis Endgame'],
  },
  {
    id: 'd4', t: 41 * 60 * 1000, type: 'armor', name: 'Lightkin Mask',
    sub: 'Hunter · Lightkin · Brawler · T5', grade: 'shard',
    isExotic: false, locked: false, perks: [], sources: [],
    icon: P + 'lightkin-mask.png',
  },
  {
    id: 'd5', t: 53 * 60 * 1000, type: 'weapon', name: 'Imperial Decree',
    sub: 'Pellet Shotgun · Strand', grade: 'shard', tier: 'C',
    isExotic: false, locked: false,
    icon: P + 'imperial-decree.png',
    perks: [
      { icon: PERK.outlaw, rolled: true, tagged: false },
      { icon: PERK.rampage, rolled: true, tagged: false },
      { icon: PERK.fieldPrep, rolled: true, tagged: false },
      { icon: PERK.surrounded, rolled: true, tagged: false },
    ],
    pool: null, sources: [],
  },
  {
    id: 'd6', t: 67 * 60 * 1000, type: 'weapon', name: 'Whisper Of The Worm',
    sub: 'Sniper Rifle · Heavy · Solar', grade: 'exotic',
    isExotic: true, locked: true, perks: [], sources: [],
    icon: P + 'whisper.png',
  },
  {
    id: 'd7', t: 88 * 60 * 1000, type: 'armor', name: 'Wraithmetal Mail',
    sub: 'Titan · Wraithmetal · Marksman · T5', grade: 'keep',
    isExotic: false, locked: true, perks: [], sources: [],
    icon: P + 'wraithmetal-mail.png',
  },
  {
    id: 'd8', t: 142 * 60 * 1000, type: 'weapon', name: 'Word Of Crota',
    sub: 'Hand Cannon · Adaptive · Solar', grade: 'shard', tier: 'F',
    isExotic: false, locked: false,
    icon: P + 'word-of-crota.png',
    perks: [
      { icon: PERK.outlaw, rolled: true, tagged: false },
      { icon: PERK.killClip, rolled: true, tagged: false },
      { icon: PERK.vorpal, rolled: true, tagged: false },
      { icon: PERK.surplus, rolled: true, tagged: false },
    ],
    pool: null, sources: [],
  },
];

const NOW = Date.now();
SAMPLE_DROPS.forEach(d => { d.timestamp = NOW - d.t; });

const SAMPLE_RULES = [
  { id: 'r1', name: 'Hunter T5 keepers', enabled: true, klass: 'Hunter', sets: ['Sundered','Lightkin'], archetypes: ['Marksman','Brawler'], tertiaries: ['Weapons','Class'], minTier: 5 },
  { id: 'r2', name: 'Warlock brawler/specialist', enabled: true, klass: 'Warlock', sets: [], archetypes: ['Brawler','Specialist'], tertiaries: [], minTier: 5 },
  { id: 'r3', name: 'Titan T4+ anything', enabled: false, klass: 'Titan', sets: [], archetypes: [], tertiaries: [], minTier: 4 },
];

Object.assign(window, { SAMPLE_DROPS, SAMPLE_RULES, PERK });
