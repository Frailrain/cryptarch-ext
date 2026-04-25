// MV3 service worker entry. Chrome wakes this worker on four events:
//   - onInstalled: extension first installed or updated
//   - onStartup: browser starts with extension already installed
//   - alarms.onAlarm: the 1-minute poll timer fires
//   - runtime.onMessage: options page asks us to sign in / poll now
//
// The worker may be torn down after ~30s of inactivity. All state lives in
// chrome.storage.local (via the storage adapter cache) or IndexedDB (manifest).
// Listeners MUST be registered at top level — Chrome needs them attached
// before any async work starts.

import { POLL_ALARM_NAME, POLL_PERIOD_MINUTES } from '@/shared/constants';
import { log, error as logError } from '@/adapters/logger';
import {
  handleGetArmorTaxonomy,
  handlePollAlarm,
  handleRetryManifest,
  handleSignIn,
  handleSignOut,
  kickoffManifestLoad,
} from './controller';
import type { Message } from '@/shared/messaging';
import {
  findMultiSourceItems,
  installWishlistDebug,
  testFallback,
  testMatch,
} from './debug-wishlists';
import { lookupItem } from '@/core/bungie/manifest';
import { appendToFeed } from '@/core/storage/drop-feed';
import type { DropFeedEntry, WishlistMatch } from '@/shared/types';
import type { Grade } from '@/core/scoring/types';
import { ensureWishlistCacheReady } from '@/core/wishlists/cache';

async function ensurePollAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(POLL_ALARM_NAME);
  // Re-create if the registered period doesn't match the constant. Alarms
  // persist across SW restarts, so a shipped change to POLL_PERIOD_MINUTES
  // would otherwise be ignored until the user manually cleared the alarm.
  if (!existing || existing.periodInMinutes !== POLL_PERIOD_MINUTES) {
    await chrome.alarms.create(POLL_ALARM_NAME, {
      periodInMinutes: POLL_PERIOD_MINUTES,
      // Fire the first poll one period after registration so we don't double-poll
      // right after install — the user hasn't signed in yet anyway.
      delayInMinutes: POLL_PERIOD_MINUTES,
    });
    log('sw', 'poll alarm registered', POLL_PERIOD_MINUTES);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  log('sw', 'onInstalled', details.reason);
  void ensurePollAlarm();
  // Kick off manifest download proactively so the options page can clear its
  // first-boot loading card without waiting for the user to sign in or for
  // the first drop to trigger a lazy fetch.
  void kickoffManifestLoad();
});

chrome.runtime.onStartup.addListener(() => {
  log('sw', 'onStartup');
  void ensurePollAlarm();
  void kickoffManifestLoad();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM_NAME) return;
  log('sw', 'alarm fired', alarm.name);
  void handlePollAlarm();
});

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'auth-start') {
        await handleSignIn();
        // Kick off a poll cycle right away so the baseline is established
        // without waiting for the next 1-minute tick.
        void handlePollAlarm();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'auth-logout') {
        await handleSignOut();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'trigger-poll-now') {
        void handlePollAlarm();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'force-rebaseline') {
        // Wipe the baseline so the next poll treats everything as "already here".
        await chrome.storage.local.remove('cryptarch:inventory-baseline');
        void handlePollAlarm();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'retry-manifest') {
        void handleRetryManifest();
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'get-armor-taxonomy') {
        const taxonomy = await handleGetArmorTaxonomy();
        sendResponse({ ok: true, payload: taxonomy });
        return;
      }
      if (msg.type === 'wishlist-test-multi-source') {
        // Hydrate the wishlist cache before discovery — this handler doesn't go
        // through handlePollAlarm, so on a fresh worker wake the in-memory Map
        // is empty until we ask for it. Without this await, findMultiSourceItems
        // would always return [] on first invocation per wake.
        await ensureWishlistCacheReady();
        // Find a hash flagged by 2+ enabled sources, then run it through the
        // matcher. Empty result is a real, expected outcome — surface it
        // explicitly so the UI can guide the user.
        const candidates = findMultiSourceItems(2, 1);
        if (candidates.length === 0) {
          sendResponse({
            ok: true,
            payload: {
              ok: false,
              message:
                'No items found matching 2+ enabled sources. Enable additional wishlists in the Wishlists tab to test multi-source matching.',
            },
          });
          return;
        }
        const candidate = candidates[0];
        const outcome = await testMatch(candidate.itemHash, candidate.samplePerks);
        let itemName: string | null = null;
        let itemIcon = '';
        let weaponSubType: string | null = null;
        try {
          const def = await lookupItem(candidate.itemHash);
          itemName = def?.displayProperties?.name ?? null;
          const iconPath = def?.displayProperties?.icon;
          if (iconPath) itemIcon = `https://www.bungie.net${iconPath}`;
          weaponSubType = def?.itemTypeDisplayName ?? null;
        } catch {
          // Manifest not ready or hash absent — UI falls back to hash.
        }
        appendTestDropToFeed({
          itemName: itemName ? `[Test] ${itemName}` : `[Test] item ${candidate.itemHash}`,
          itemIcon,
          weaponType: weaponSubType,
          grade: outcome.grade,
          wishlistMatches: outcome.wishlistMatches,
        });
        sendResponse({
          ok: true,
          payload: {
            ok: true,
            itemHash: candidate.itemHash,
            itemName,
            grade: outcome.grade,
            wishlistMatches: outcome.wishlistMatches,
            reasons: outcome.reasons,
            perks: candidate.samplePerks,
          },
        });
        return;
      }
      if (msg.type === 'wishlist-test-fallback') {
        const outcome = await testFallback();
        appendTestDropToFeed({
          itemName: '[Test] Unrecognized legendary',
          itemIcon: '',
          weaponType: 'Test fallback',
          grade: outcome.grade,
          wishlistMatches: outcome.wishlistMatches,
        });
        sendResponse({
          ok: true,
          payload: {
            grade: outcome.grade,
            wishlistMatches: outcome.wishlistMatches,
            reasons: outcome.reasons,
          },
        });
        return;
      }
      sendResponse({ ok: false, error: `unknown message ${msg.type}` });
    } catch (err) {
      logError('sw', 'message handler error', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep sendResponse open for async reply
});

// Install Brief #11 debug helpers on globalThis. Each SW wake re-attaches them
// since module-level state doesn't persist across teardown. See
// debug-wishlists.ts for usage.
installWishlistDebug();

// Warm the wishlist cache on every SW wake, not just when handlePollAlarm runs.
// Otherwise debug helpers and message handlers that don't await
// ensureWishlistCacheReady themselves see an empty Map even though storage is
// fully populated. Fire-and-forget; concurrent awaits in handlers all share the
// same hydration promise via ensureLoaded() and the idempotent `hydrated` flag.
void ensureWishlistCacheReady().catch((err) => {
  logError('sw', 'wishlist cache warm-up failed', err);
});

// Synthesize a DropFeedEntry from a test-handler outcome and append it to the
// feed. Mirrors the shape produced by handleNewDrops in controller.ts so the
// drop renders identically in DropLogPanel — same grade chip, same wishlist
// match path, same source-tag rendering once Part F lands. The "[Test]" name
// prefix keeps it visually distinct from real drops.
function appendTestDropToFeed(input: {
  itemName: string;
  itemIcon: string;
  weaponType: string | null;
  grade: Grade | null;
  wishlistMatches: WishlistMatch[];
}): void {
  const entry: DropFeedEntry = {
    instanceId: `debug-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemName: input.itemName,
    itemIcon: input.itemIcon,
    itemType: 'weapon',
    grade: input.grade,
    timestamp: Date.now(),
    locked: false,
    perkIcons: [],
    weaponType: input.weaponType,
    armorMatched: null,
    armorClass: null,
    armorSet: null,
    armorArchetype: null,
    armorTertiary: null,
    armorTier: null,
    isExotic: false,
    wishlistMatches:
      input.wishlistMatches.length > 0 ? input.wishlistMatches : undefined,
  };
  appendToFeed(entry);
}

log('sw', 'service worker loaded');
