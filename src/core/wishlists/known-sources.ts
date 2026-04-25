import type { WishlistSource } from '@/shared/types';

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
export const BUILTIN_WISHLIST_SOURCES: WishlistSource[] = [
  {
    id: 'voltron',
    name: 'Voltron',
    url: 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt',
    enabled: true,
    builtin: true,
    description:
      'The default community wishlist. Broad "god roll" coverage by pandapaxxy, mercules904, and HavocsCall.',
  },
  {
    id: 'choosy-voltron',
    name: 'Choosy Voltron',
    url: 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/choosy_voltron.txt',
    enabled: true,
    builtin: true,
    description:
      'Voltron plus opinionated "trash" rolls. Helps identify rolls you should dismantle.',
  },
  {
    id: 'aegis-endgame',
    name: 'Aegis Endgame Analysis',
    url: 'https://raw.githubusercontent.com/Ciceron14/dim-extra-wishlists/main/Aegis%20Spreadsheets%20Wishlists/Aegis%20Endgame%20Analysis/dim_aegis_endgame.txt',
    enabled: true,
    builtin: true,
    description:
      "Endgame-focused rolls from Aegis's spreadsheets. More selective than Voltron.",
  },
  {
    id: 'aegis-exclusive',
    name: 'Aegis Exclusive',
    url: 'https://raw.githubusercontent.com/Ciceron14/dim-extra-wishlists/main/Aegis%20Spreadsheets%20Wishlists/Aegis%20Endgame%20Analysis/dim_aegis_endgame-exclusive.txt',
    enabled: true,
    builtin: true,
    description:
      'The most selective subset of Aegis Endgame — ~3.1k rolls vs ~9k in the main list. For users who want the strictest filtering.',
  },
];
