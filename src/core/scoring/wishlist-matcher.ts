import type { NewItemDrop } from '@/shared/types';
import type { ImportedWishList, WishListEntry } from './types';

export function matchDropAgainstWishlists(
  drop: NewItemDrop,
  wishlists: ImportedWishList[],
  enhancedPerkMap: Map<number, number>,
): WishListEntry | null {
  const activePerks = new Set<number>();
  for (const p of drop.perks) {
    if (p.isActive) activePerks.add(p.plugHash);
  }

  const resolvedPerks = new Set<number>(activePerks);
  for (const perk of activePerks) {
    const base = enhancedPerkMap.get(perk);
    if (base !== undefined) resolvedPerks.add(base);
  }

  let firstTrash: WishListEntry | null = null;

  for (const list of wishlists) {
    for (const entry of list.entries) {
      if (entry.itemHash !== -1 && entry.itemHash !== drop.itemHash) continue;

      if (entry.requiredPerks.length === 0) {
        if (!entry.isTrash) return entry;
        if (!firstTrash) firstTrash = entry;
        continue;
      }

      let allPresent = true;
      for (const req of entry.requiredPerks) {
        if (!resolvedPerks.has(req)) {
          allPresent = false;
          break;
        }
      }
      if (!allPresent) continue;

      if (!entry.isTrash) return entry;
      if (!firstTrash) firstTrash = entry;
    }
  }

  return firstTrash;
}
