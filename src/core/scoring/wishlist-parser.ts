import { warn } from '@/adapters/logger';
import type { TierLetter } from '@/shared/types';
import type { ImportedWishList, WishListEntry } from './types';

const ENTRY_REGEX = /^dimwishlist:item=(-?\d+)(?:&perks=([\d,]*))?(?:#notes:(.*))?$/;
// Per-weapon tier extraction. Matches "S Tier", "A-Tier", "B Tier rolls" etc.
// anywhere in the note text. Word boundaries on both sides keep it from
// matching things like "MASTier" or "S TierEXTRA". Letter-then-separator-then-Tier.
//
// Why this works on Voltron's verbose Adamsdown_Boy notes too: those notes
// frequently contain phrases like "rated C-Tier for endgame PvE by @TheAegisRelic"
// — the captured C is genuinely the weapon family's tier per Aegis, just quoted
// in someone else's commentary. So the regex picks up correct cross-source
// tier signals as a side effect.
const TIER_REGEX = /\b([SABCDF])[\s-]+Tier\b/i;

// Yield to the event loop every N lines while parsing. The Voltron file is
// ~280k lines; without yielding, the regex loop blocks the JS thread for
// ~500-1000 ms — visible as UI freeze in the Wishlists tab during refresh.
// 10k lines per chunk works out to ~25 yields for Voltron, ~100 ms total
// added overhead, but the UI thread interleaves React updates between chunks.
const PARSE_YIELD_EVERY = 10_000;

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * DIM wishlist parser. Handles two coexisting note formats found across
 * community sources:
 *
 *   1. Inline: `dimwishlist:item=X&perks=Y#notes:N` — used by older Voltron
 *      entries and some single-curator sources.
 *   2. Preceding block: `//notes:N` lines that apply to the dimwishlist
 *      entries that follow until the next `// {weapon header}` resets state —
 *      used by Aegis sources and most Voltron entries (8k+ blocks vs 2.7k
 *      inline lines on the current Voltron file).
 *
 * Per-weapon `weaponTier` is extracted only from preceding-block notes via
 * TIER_REGEX. Inline notes don't carry tier info in any known format. When a
 * dimwishlist line has both inline notes AND a preceding-block note in scope,
 * inline wins for the notes field (it's per-roll vs per-weapon).
 *
 * State reset rules:
 *   - Any `//` comment line that isn't `//notes:` resets currentNotes and
 *     currentTier (typically a `// Weapon Name` header).
 *   - Empty lines and non-comment lines (like `title:` / `description:` headers
 *     at file top) are skipped without affecting state.
 *   - When two consecutive `//notes:` lines appear under one weapon header
 *     (Voltron pattern: perk-summary line then long-form analysis line), the
 *     LAST one wins. This loses the first note but the analysis line is the
 *     one that carries tier info, which matters more for Brief #12.
 */
export async function parseWishlist(
  source: string,
  meta: { id: string; name: string; sourceUrl: string | null },
): Promise<ImportedWishList> {
  const stripped = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = stripped.split(/\r?\n/);

  const entries: WishListEntry[] = [];
  let currentNotes: string | null = null;
  let currentTier: TierLetter | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % PARSE_YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }

    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('//notes:')) {
      const noteText = line.slice('//notes:'.length).trim();
      currentNotes = noteText;
      const tierMatch = TIER_REGEX.exec(noteText);
      currentTier = tierMatch ? (tierMatch[1].toUpperCase() as TierLetter) : null;
      continue;
    }

    // Any other comment line (including `// Weapon Name` headers) resets state.
    // Without this reset, a weapon with no `//notes:` block would inherit the
    // previous weapon's tier and notes.
    if (line.startsWith('//')) {
      currentNotes = null;
      currentTier = null;
      continue;
    }

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

    const inlineNotes = (m[3] ?? '').trim();
    // Inline notes are per-roll; preceding-block notes are per-weapon. When
    // both are present, the inline notes are more specific to this entry.
    const notes = inlineNotes || currentNotes || '';

    const entry: WishListEntry = {
      sourceListId: meta.id,
      itemHash,
      requiredPerks,
      isTrash,
      notes,
    };
    if (currentTier) entry.weaponTier = currentTier;
    entries.push(entry);
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
