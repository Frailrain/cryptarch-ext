import { warn } from '@/adapters/logger';
import type { ImportedWishList, WishListEntry } from './types';

const ENTRY_REGEX = /^dimwishlist:item=(-?\d+)(?:&perks=([\d,]*))?(?:#notes:(.*))?$/;

// Yield to the event loop every N lines while parsing. The Voltron file is
// ~280k lines; without yielding, the regex loop blocks the JS thread for
// ~500-1000 ms — visible as UI freeze in the Wishlists tab during refresh.
// 10k lines per chunk works out to ~25 yields for Voltron, ~100 ms total
// added overhead, but the UI thread interleaves React updates between chunks.
const PARSE_YIELD_EVERY = 10_000;

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function parseWishlist(
  source: string,
  meta: { id: string; name: string; sourceUrl: string | null },
): Promise<ImportedWishList> {
  const stripped = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = stripped.split(/\r?\n/);

  const entries: WishListEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % PARSE_YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith('dimwishlist:')) continue;

    const m = ENTRY_REGEX.exec(line);
    if (!m) {
      warn('wishlist', 'skipping malformed line', line, i + 1);
      continue;
    }

    const rawItem = Number(m[1]);
    if (!Number.isFinite(rawItem)) {
      warn('wishlist', 'skipping malformed line (bad item)', line, i + 1);
      continue;
    }

    let itemHash: number;
    let isTrash = false;
    if (rawItem === -1) {
      itemHash = -1;
    } else if (rawItem < -1) {
      itemHash = Math.abs(rawItem);
      isTrash = true;
    } else {
      itemHash = rawItem;
    }

    const perksRaw = m[2] ?? '';
    const requiredPerks = perksRaw
      ? perksRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];

    const notes = (m[3] ?? '').trim();

    entries.push({
      sourceListId: meta.id,
      itemHash,
      requiredPerks,
      isTrash,
      notes,
    });
  }

  return {
    id: meta.id,
    name: meta.name,
    sourceUrl: meta.sourceUrl,
    entries,
    importedAt: Date.now(),
    entryCount: entries.length,
  };
}
