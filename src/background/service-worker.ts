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
  cacheSummary,
  findMultiSourceItems,
  installWishlistDebug,
  testFallback,
  testMatch,
} from './debug-wishlists';
import { getEnhancedPerkMap, getManifest, lookupItem } from '@/core/bungie/manifest';
import { appendToFeed, getFeedEntry, updateFeedLock } from '@/core/storage/drop-feed';
import { setLockState } from '@/core/bungie/api';
import { ItemType } from '@/shared/types';
import type { DropFeedEntry, TierLetter, WishlistMatch } from '@/shared/types';
import { ensureWishlistCacheReady } from '@/core/wishlists/cache';
import { resolveBestTier } from '@/core/wishlists/matcher';
import { runPollCycle } from '@/core/bungie/inventory';
import { loadPrimaryMembership } from '@/core/storage/tokens';
import { loadArmorRules } from '@/core/rules/armor-rules';
import { loadScoringConfig } from '@/core/storage/scoring-config';
import { scoreItem } from '@/core/scoring/engine';

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
      if (msg.type === 'lock-drop') {
        // User-initiated manual lock from the Drop Log row's lock icon.
        // Reuses the same SetLockState API the autolock path uses; differs
        // only in that we don't run through attemptAutoLock's retry/backoff
        // (a manual click is a one-shot — the user can click again if they
        // want to retry).
        const payload = msg.payload as { instanceId?: string } | undefined;
        const instanceId = payload?.instanceId;
        if (!instanceId) {
          sendResponse({ ok: false, error: 'Missing instanceId' });
          return;
        }
        const entry = getFeedEntry(instanceId);
        if (!entry) {
          sendResponse({ ok: false, error: 'Drop not found in feed' });
          return;
        }
        if (entry.locked) {
          sendResponse({ ok: true });
          return;
        }
        if (!entry.characterId) {
          sendResponse({
            ok: false,
            error: 'Drop has no characterId — cannot manually lock',
          });
          return;
        }
        const primary = loadPrimaryMembership();
        if (!primary) {
          sendResponse({ ok: false, error: 'Not signed in' });
          return;
        }
        try {
          await setLockState(
            primary.membershipType,
            entry.characterId,
            entry.instanceId,
            true,
          );
          updateFeedLock(entry.instanceId, true);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (msg.type === 'get-armor-taxonomy') {
        const taxonomy = await handleGetArmorTaxonomy();
        sendResponse({ ok: true, payload: taxonomy });
        return;
      }
      if (msg.type === 'wishlist-test-multi-source') {
        // ensureWishlistCacheReady is also awaited inside findMultiSourceItems
        // and cacheSummary now, but call it here too so the diagnostic snapshot
        // below sees the same warm cache the discovery does.
        await ensureWishlistCacheReady();
        // Pull a large pool of candidates so we can show variety across tiers.
        // Each click of "Run multi-source test" buckets candidates by their
        // best tier and picks a random non-empty bucket → random candidate.
        // This exercises the tier filter naturally over a few clicks instead
        // of always producing an S-tier drop.
        const candidates = await findMultiSourceItems(2, 500);
        if (candidates.length === 0) {
          const summary = await cacheSummary();
          sendResponse({
            ok: true,
            payload: {
              ok: false,
              message:
                'No items found matching 2+ enabled sources. See diagnostic below to confirm the SW sees what you expect.',
              diagnostic: summary,
            },
          });
          return;
        }
        const buckets = new Map<string, typeof candidates>();
        for (const c of candidates) {
          const key = c.bestTier ?? 'untiered';
          const existing = buckets.get(key);
          if (existing) existing.push(c);
          else buckets.set(key, [c]);
        }
        const bucketKeys = Array.from(buckets.keys());
        const pickedKey = bucketKeys[Math.floor(Math.random() * bucketKeys.length)];
        const bucket = buckets.get(pickedKey)!;
        const candidate = bucket[Math.floor(Math.random() * bucket.length)];
        const outcome = await testMatch(candidate.itemHash, candidate.samplePerks);
        let itemName: string | null = null;
        let itemIcon = '';
        let weaponSubType: string | null = null;
        const perkIcons: string[] = [];
        try {
          const def = await lookupItem(candidate.itemHash);
          itemName = def?.displayProperties?.name ?? null;
          const iconPath = def?.displayProperties?.icon;
          if (iconPath) itemIcon = `https://www.bungie.net${iconPath}`;
          weaponSubType = def?.itemTypeDisplayName ?? null;
          // Look up icon URLs for the synthetic drop's perks so the test entry
          // renders the same way real drops do (up to 4 perk icons in the row).
          for (const perkHash of candidate.samplePerks.slice(0, 4)) {
            const perkDef = await lookupItem(perkHash);
            const perkIconPath = perkDef?.displayProperties?.icon;
            if (perkIconPath) perkIcons.push(`https://www.bungie.net${perkIconPath}`);
          }
        } catch {
          // Manifest not ready or hash absent — UI falls back to hash; perks just empty.
        }
        const resolvedTier = resolveBestTier(outcome.wishlistMatches);
        appendTestDropToFeed({
          itemName: itemName ? `[Test] ${itemName}` : `[Test] item ${candidate.itemHash}`,
          itemIcon,
          weaponType: weaponSubType,
          wishlistMatches: outcome.wishlistMatches,
          perkIcons,
          weaponTier: resolvedTier,
        });
        sendResponse({
          ok: true,
          payload: {
            ok: true,
            itemHash: candidate.itemHash,
            itemName,
            wishlistMatches: outcome.wishlistMatches,
            weaponTier: resolvedTier,
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
          wishlistMatches: outcome.wishlistMatches,
        });
        sendResponse({
          ok: true,
          payload: {
            wishlistMatches: outcome.wishlistMatches,
            reasons: outcome.reasons,
          },
        });
        return;
      }
      if (msg.type === 'wishlist-test-armor') {
        // Pull a random armor piece from the user's current Destiny inventory,
        // run it through scoreItem, append the result to the drop log. Calls
        // runPollCycle with an empty baseline so every current item comes back
        // as a "new drop" with full perk/stat metadata via buildDrops; we
        // ignore updatedBaseline so we don't disturb the real poll baseline.
        await ensureWishlistCacheReady();
        const membership = loadPrimaryMembership();
        if (!membership) {
          sendResponse({
            ok: true,
            payload: {
              ok: false,
              message: 'Not signed in. Sign in to test against your inventory.',
            },
          });
          return;
        }
        const cycle = await runPollCycle(
          membership.membershipType,
          membership.membershipId,
          {},
        );
        const armorDrops = cycle.newDrops.filter(
          (d) => d.itemTypeEnum === ItemType.Armor,
        );
        if (armorDrops.length === 0) {
          sendResponse({
            ok: true,
            payload: {
              ok: false,
              message:
                'No armor found in your current inventory snapshot. Try playing for a bit then re-running.',
            },
          });
          return;
        }
        const drop = armorDrops[Math.floor(Math.random() * armorDrops.length)];
        const config = loadScoringConfig();
        config.armorRules = loadArmorRules();
        let perkMap = new Map<number, number>();
        try {
          await getManifest();
          perkMap = await getEnhancedPerkMap();
        } catch {
          // Manifest issues degrade weapon perk resolution; armor scoring is
          // unaffected so continue.
        }
        const scoreResult = scoreItem(drop, config, perkMap);
        const armorRoll = scoreResult.armorRoll;
        const entry: DropFeedEntry = {
          instanceId: `debug-test-armor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          itemName: `[Test] ${drop.name}`,
          itemIcon: drop.iconUrl,
          itemType: 'armor',
          timestamp: Date.now(),
          locked: false,
          perkIcons: drop.perks
            .slice(0, 4)
            .map((p) => p.plugIcon)
            .filter((i) => i.length > 0),
          weaponType: null,
          armorMatched: scoreResult.armorMatched,
          armorClass: armorRoll?.armorClass ?? null,
          armorSet: armorRoll?.setName ?? null,
          armorArchetype: armorRoll?.archetype ?? null,
          armorTertiary: armorRoll?.tertiaryStat?.name ?? null,
          armorTier:
            armorRoll?.tier === 4 || armorRoll?.tier === 5 ? armorRoll.tier : null,
          isExotic: drop.tierType === 'Exotic',
        };
        appendToFeed(entry);
        sendResponse({
          ok: true,
          payload: {
            ok: true,
            itemHash: drop.itemHash,
            itemName: drop.name,
            armorMatched: scoreResult.armorMatched,
            armorClass: armorRoll?.armorClass ?? null,
            armorSet: armorRoll?.setName ?? null,
            armorArchetype: armorRoll?.archetype ?? null,
            armorTertiary: armorRoll?.tertiaryStat?.name ?? null,
            armorTier: armorRoll?.tier ?? null,
            isExotic: drop.tierType === 'Exotic',
            matchedRule: scoreResult.matchedArmorRule?.name ?? null,
            reasons: scoreResult.reasons,
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
  wishlistMatches: WishlistMatch[];
  perkIcons?: string[];
  weaponTier?: TierLetter;
}): void {
  const entry: DropFeedEntry = {
    instanceId: `debug-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemName: input.itemName,
    itemIcon: input.itemIcon,
    itemType: 'weapon',
    timestamp: Date.now(),
    locked: false,
    perkIcons: input.perkIcons ?? [],
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
    weaponTier: input.weaponTier,
  };
  appendToFeed(entry);
}

log('sw', 'service worker loaded');
