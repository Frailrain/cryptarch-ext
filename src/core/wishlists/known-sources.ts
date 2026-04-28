import type { CharlesSourceConfig, WishlistSource } from '@/shared/types';
import { DEFAULT_CHARLES_CONFIG } from '@/shared/types';

// Brief #19: Charles MRF_PPC selector URL builder. Maps the user's
// minTier + ppc selection to one of the 28 pre-built .txt files in
// charlesxcaliber/DIMAegisWeaponWishlist. The Weapons tab radios drive
// this; loadWishlistSources injects the computed URL onto the runtime
// charles-aegis-tiered source so fetch.ts can treat it like any other.
export function computeCharlesUrl(config: CharlesSourceConfig): string {
  return (
    'https://raw.githubusercontent.com/charlesxcaliber/DIMAegisWeaponWishlist/main/' +
    `MrCharlesWishlist_MR${config.minTier}_PPC${config.ppc}.txt`
  );
}

// Stable identifier for the Charles configurable source. Used by storage,
// matcher, and the WeaponsPanel; central constant prevents drift.
export const CHARLES_SOURCE_ID = 'charles-aegis-tiered';

// Curated community wishlist sources shipped with Cryptarch. Users can enable
// or disable any of these at runtime, but cannot delete them. URL changes go
// here; user data in storage tracks only the enabled flag (and any user-added
// custom sources, which live alongside these).
//
// Verified live 2026-04-24:
//   - Voltron / Choosy Voltron: 48klocs/dim-wish-list-sources, ~247k entries
//   - Aegis Endgame Analysis:    Ciceron14/dim-extra-wishlists, ~9k entries
//   - Aegis Exclusive:           same repo, ~3k entries (most selective subset)
//
// Sliflist (rslifka/sliflist) was retired — repo deleted by owner. Users who
// want it back can paste a URL via the custom-source UI if it returns.
//
// Brief #12 note: no PVP source ships as a built-in. The two best-known
// candidates (PandaPaxxy and Mercules904) live as subfolders inside the
// 48klocs repo, but their files target seasons through Haunted (S17, mid-2022)
// and haven't been updated since 2025-04 (>1 year stale, outside the brief's
// 6-month threshold). The only recently-touched candidate found
// (abdulazizfahad97-web/azyz-dim-wishlists/pvp.txt) ships DIM search-bar
// filters rather than dimwishlist:item= entries — wrong format, doesn't
// parse. Revisit when PandaPaxxy returns or another active curator emerges.
// Users with their own PVP wishlist can add it via the custom URL form.
export const BUILTIN_WISHLIST_SOURCES: WishlistSource[] = [
  {
    id: 'voltron',
    name: 'Voltron',
    url: 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt',
    enabled: true,
    builtin: true,
    description:
      'The default community wishlist. Broad "god roll" coverage by pandapaxxy, mercules904, and HavocsCall.',
    pveOriented: false,
    pvpOriented: false,
  },
  {
    id: 'choosy-voltron',
    name: 'Choosy Voltron',
    url: 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/choosy_voltron.txt',
    enabled: true,
    builtin: true,
    description:
      'Voltron plus opinionated "trash" rolls. Helps identify rolls you should dismantle.',
    pveOriented: false,
    pvpOriented: false,
  },
  {
    id: 'aegis-endgame',
    name: 'Aegis Endgame Analysis',
    url: 'https://raw.githubusercontent.com/Ciceron14/dim-extra-wishlists/main/Aegis%20Spreadsheets%20Wishlists/Aegis%20Endgame%20Analysis/dim_aegis_endgame.txt',
    enabled: true,
    builtin: true,
    description:
      "Endgame-focused rolls from Aegis's spreadsheets. More selective than Voltron.",
    pveOriented: true,
    pvpOriented: false,
  },
  {
    id: 'aegis-exclusive',
    name: 'Aegis Exclusive',
    url: 'https://raw.githubusercontent.com/Ciceron14/dim-extra-wishlists/main/Aegis%20Spreadsheets%20Wishlists/Aegis%20Endgame%20Analysis/dim_aegis_endgame-exclusive.txt',
    enabled: true,
    builtin: true,
    description:
      'The most selective subset of Aegis Endgame — ~3.1k rolls vs ~9k in the main list. For users who want the strictest filtering.',
    pveOriented: true,
    pvpOriented: false,
  },
  {
    id: CHARLES_SOURCE_ID,
    name: 'Aegis Tiered (Charles)',
    // Placeholder URL — loadWishlistSources rewrites this from the user's
    // current charlesSourceConfig before the source ever reaches fetch.ts.
    // The built-in defaults to the most permissive variant (MRF_PPC0).
    url: computeCharlesUrl(DEFAULT_CHARLES_CONFIG),
    enabled: true,
    builtin: true,
    configurable: true,
    description:
      "Aegis spreadsheet rendered with full S-F tier coverage by MrCharles. Configurable via the Weapons tab.",
    pveOriented: true,
    pvpOriented: false,
  },
];
