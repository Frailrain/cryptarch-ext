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
import {
  ensureWishlistCacheReady,
  hydrateWishlistCacheForWorker,
  removeFromCache,
} from '@/core/wishlists/cache';
import { resolveBestTier } from '@/core/wishlists/matcher';
import { refreshOne, validateWishlistUrl } from '@/core/wishlists/fetch';
import { getCachedPerkPool, sweepStalePerkPool } from '@/core/bungie/perk-pool-cache';
import { runPollCycle } from '@/core/bungie/inventory';
import { loadPrimaryMembership } from '@/core/storage/tokens';
import { loadArmorRules } from '@/core/rules/armor-rules';
import {
  loadScoringConfig,
  loadWishlistSources,
} from '@/core/storage/scoring-config';
import { scoreItem } from '@/core/scoring/engine';

// In-flight guard for per-source wishlist refresh. SW is the single owner of
// refresh; if multiple refreshOne calls for the same source arrive while one
// is mid-flight, they share the same Promise so callers resolve together
// rather than triggering parallel fetches.
const refreshOneInFlight = new Map<string, Promise<unknown>>();

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
  void bootManifestThenSweep();
});

chrome.runtime.onStartup.addListener(() => {
  log('sw', 'onStartup');
  void ensurePollAlarm();
  void bootManifestThenSweep();
});

// Brief #14 Part C: chain the perk-pool sweep after manifest load. By the
// time kickoffManifestLoad resolves the SW has been awake long enough that
// the "skip if SW just woke" guard from the brief is automatically satisfied,
// and the manifest version is now known. If kickoffManifestLoad failed, the
// sweep no-ops (currentManifestVersion returns null inside the cache module).
async function bootManifestThenSweep(): Promise<void> {
  await kickoffManifestLoad();
  await sweepStalePerkPool();
}

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
      if (msg.type === 'wishlists:refreshOne') {
        const sourceId = (msg.payload as { sourceId?: string } | undefined)?.sourceId;
        const force = Boolean((msg.payload as { force?: boolean } | undefined)?.force);
        if (!sourceId) {
          sendResponse({ ok: false, error: 'Missing sourceId' });
          return;
        }
        const source = loadWishlistSources().find((s) => s.id === sourceId);
        if (!source) {
          sendResponse({ ok: false, error: `Unknown sourceId: ${sourceId}` });
          return;
        }
        await hydrateWishlistCacheForWorker();
        let inFlight = refreshOneInFlight.get(sourceId);
        if (!inFlight) {
          inFlight = refreshOne(source, { force });
          refreshOneInFlight.set(sourceId, inFlight);
          void inFlight.finally(() => {
            refreshOneInFlight.delete(sourceId);
          });
        }
        try {
          const result = await inFlight;
          sendResponse({ ok: true, payload: { result } });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (msg.type === 'wishlists:validateUrl') {
        const url = (msg.payload as { url?: string } | undefined)?.url;
        if (!url) {
          sendResponse({ ok: false, error: 'Missing url' });
          return;
        }
        try {
          const result = await validateWishlistUrl(url);
          sendResponse({ ok: true, payload: result });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (msg.type === 'perkPool:get') {
        // Brief #14 Part E: dashboard click-to-expand and idle prewarm both
        // route through here. The cache module's in-flight guard coalesces
        // overlapping requests for the same weapon (a prewarm racing a click).
        const weaponHash = (msg.payload as { weaponHash?: number } | undefined)?.weaponHash;
        if (typeof weaponHash !== 'number') {
          sendResponse({ ok: false, error: 'Missing weaponHash' });
          return;
        }
        try {
          const snapshot = await getCachedPerkPool(weaponHash);
          sendResponse({ ok: true, payload: { snapshot } });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      if (msg.type === 'wishlists:dropSource') {
        const sourceId = (msg.payload as { sourceId?: string } | undefined)?.sourceId;
        if (!sourceId) {
          sendResponse({ ok: false, error: 'Missing sourceId' });
          return;
        }
        await hydrateWishlistCacheForWorker();
        removeFromCache(sourceId);
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
        // Brief #14 Part E redesign: prefer a real inventory weapon so the
        // expand-on-click view renders against actual rolled perks (not perks
        // synthesized from the wishlist's required-perk list, which may not
        // correspond to any roll the user has ever owned). Falls back to the
        // synthetic path if not signed in or no qualifying inventory weapon.
        const fromInventory = await tryRealInventoryMultiSource();
        if (fromInventory) {
          appendTestDropToFeed(fromInventory.entry);
          sendResponse({
            ok: true,
            payload: { ok: true, source: 'inventory', ...fromInventory.payload },
          });
          return;
        }
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
          itemHash: candidate.itemHash,
          itemName: itemName ? `[Test] ${itemName}` : `[Test] item ${candidate.itemHash}`,
          itemIcon,
          weaponType: weaponSubType,
          wishlistMatches: outcome.wishlistMatches,
          perkIcons,
          perkHashes: candidate.samplePerks.slice(0, 4),
          weaponTier: resolvedTier,
        });
        sendResponse({
          ok: true,
          payload: {
            ok: true,
            // Tells the test panel which path produced this drop. Inventory =
            // real perks; synthesized = perks from the wishlist's required
            // perks (no guarantee the user has ever owned this exact roll).
            source: 'synthesized',
            message:
              'No multi-source weapon in current inventory — using synthesized test data.',
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
// Brief #14 Part E redesign: scan the user's live inventory for a weapon that
// matches 2+ enabled wishlist sources. Returns null when not signed in, no
// inventory accessible, or no qualifying weapon — caller falls back to the
// synthetic test path. The runPollCycle-with-empty-baseline trick mirrors
// the wishlist-test-armor handler: every current item comes back as a "new
// drop" with full perk metadata, and we discard cycle.updatedBaseline so the
// real poll baseline is undisturbed.
async function tryRealInventoryMultiSource(): Promise<{
  entry: Parameters<typeof appendTestDropToFeed>[0];
  payload: Record<string, unknown>;
} | null> {
  const membership = loadPrimaryMembership();
  if (!membership) return null;
  let cycle: Awaited<ReturnType<typeof runPollCycle>>;
  try {
    cycle = await runPollCycle(membership.membershipType, membership.membershipId, {});
  } catch {
    return null;
  }
  const weapons = cycle.newDrops.filter((d) => d.itemTypeEnum === 3);
  if (weapons.length === 0) return null;

  const config = loadScoringConfig();
  config.armorRules = loadArmorRules();
  let perkMap = new Map<number, number>();
  try {
    await getManifest();
    perkMap = await getEnhancedPerkMap();
  } catch {
    return null; // no manifest = no useful matching, give up to synthetic path
  }

  // Score each weapon and keep ones that hit 2+ sources, matching the
  // synthetic path's "multi-source" criterion. Cheap loop — scoring is
  // cache lookups in the warmed wishlist matcher.
  type Scored = {
    drop: (typeof weapons)[number];
    matches: ReturnType<typeof scoreItem>['wishlistMatches'];
  };
  const qualifying: Scored[] = [];
  for (const drop of weapons) {
    const result = scoreItem(drop, config, perkMap);
    if (result.wishlistMatches.length >= 2) {
      qualifying.push({ drop, matches: result.wishlistMatches });
    }
  }
  if (qualifying.length === 0) return null;

  const picked = qualifying[Math.floor(Math.random() * qualifying.length)];
  const drop = picked.drop;
  const matches = picked.matches;

  // Mirror the controller's perkIcons + perkHashes capture so the test entry
  // renders identically to a real captured drop. Filter by perk-pool snapshot
  // socket indices when available (Brief #14.3 Bug 1) so the test row's
  // column count matches a real drop's column count.
  let perkIndices: Set<number> | null = null;
  try {
    const snapshot = await getCachedPerkPool(drop.itemHash);
    if (snapshot) {
      perkIndices = new Set(snapshot.columns.map((c) => c.socketIndex));
    }
  } catch {
    // ignore — falls back to slice
  }
  const renderable = perkIndices
    ? drop.perks.filter((p) => perkIndices!.has(p.columnIndex) && p.plugIcon.length > 0)
    : drop.perks.slice(0, 6).filter((p) => p.plugIcon.length > 0);
  const canon = (h: number) => perkMap.get(h) ?? h;
  const perkIcons = renderable.map((p) => p.plugIcon);
  const perkHashes = renderable.map((p) => canon(p.plugHash));
  const unlockedPerksBySocketIndex: Record<number, number[]> = {};
  for (const p of renderable) {
    unlockedPerksBySocketIndex[p.columnIndex] = (
      p.unlockedPlugHashes ?? [p.plugHash]
    ).map(canon);
  }
  const canonicalizedMatches = matches.map((m) =>
    m.taggedPerkHashes
      ? { ...m, taggedPerkHashes: m.taggedPerkHashes.map(canon) }
      : m,
  );
  const tier = resolveBestTier(canonicalizedMatches);

  return {
    entry: {
      itemHash: drop.itemHash,
      itemName: `[Test] ${drop.name}`,
      itemIcon: drop.iconUrl,
      weaponType: drop.itemSubType,
      wishlistMatches: canonicalizedMatches,
      perkIcons,
      perkHashes,
      unlockedPerksBySocketIndex,
      weaponTier: tier,
    },
    payload: {
      itemHash: drop.itemHash,
      itemName: drop.name,
      wishlistMatches: canonicalizedMatches,
      weaponTier: tier,
    },
  };
}

function appendTestDropToFeed(input: {
  itemName: string;
  itemIcon: string;
  weaponType: string | null;
  wishlistMatches: WishlistMatch[];
  perkIcons?: string[];
  weaponTier?: TierLetter;
  // Brief #14 Part E: needed to make test drops expandable. Multi-source
  // and fallback test paths know the itemHash; armor test path doesn't,
  // and that's fine — expand only matters for weapons with random rolls.
  itemHash?: number;
  perkHashes?: number[];
  // Brief #14.4: per-socket unlocked set. Real-inventory test path
  // populates this from drop.perks; the synthesized path leaves it absent
  // so the display model falls back to single-perk-per-column from
  // perkHashes alone.
  unlockedPerksBySocketIndex?: Record<number, number[]>;
}): void {
  const entry: DropFeedEntry = {
    instanceId: `debug-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemHash: input.itemHash,
    itemName: input.itemName,
    itemIcon: input.itemIcon,
    itemType: 'weapon',
    timestamp: Date.now(),
    locked: false,
    perkIcons: input.perkIcons ?? [],
    perkHashes: input.perkHashes,
    unlockedPerksBySocketIndex: input.unlockedPerksBySocketIndex,
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
