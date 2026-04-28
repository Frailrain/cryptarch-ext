// Controller — session-1 scope. The Overwolf controller was ~500 lines across
// many briefs (autolock, notifications, rules UI wiring). This version covers:
//
//   1. Poll cycle: rehydrate baseline → fetch Bungie profile → diff → score
//      each new drop → append to drop-feed → persist baseline back.
//   2. Flap suppression: drops already in the feed are skipped to avoid
//      re-scoring when Bungie's profile API briefly omits then re-adds an item.
//   3. Sign-in: launches chrome.identity flow, fetches memberships, persists
//      the primary Destiny membership.
//
// Autolock, chrome.notifications, and rules UI wiring are deferred to session 2.

import { ensureLoaded, getItem, setItem } from '@/adapters/storage';
import { log, logJson, error as logError } from '@/adapters/logger';
import { getMembershipsForCurrentUser } from '@/core/bungie/api';
import {
  isLoggedIn,
  startLoginFlow,
  logout as bungieLogout,
} from '@/core/bungie/auth';
import { getManifest, getEnhancedPerkMap } from '@/core/bungie/manifest';
import { listArmorArchetypes, listArmorSets } from '@/core/scoring/armor-roll';
import { ARMOR_TERTIARIES } from '@/core/rules/armor-rules';
import {
  runPollCycle,
  type BaselineMap,
  type DeletedItem,
} from '@/core/bungie/inventory';
import { scoreItem } from '@/core/scoring/engine';
import { loadArmorRules } from '@/core/rules/armor-rules';
import {
  loadCharlesSourceConfig,
  loadScoringConfig,
  loadWeaponFilterConfig,
} from '@/core/storage/scoring-config';
import { ensureWishlistCacheReady } from '@/core/wishlists/cache';
import { collectWeaponGodrolls, resolveBestTier } from '@/core/wishlists/matcher';
import { CHARLES_SOURCE_ID } from '@/core/wishlists/known-sources';
import { getCachedPerkPool } from '@/core/bungie/perk-pool-cache';

// Brief #20: notification-side Voltron family identifier set. Same two ids
// the matcher uses for confirmsCharles tagging; centralized here as a
// const so the notification branch doesn't accidentally drift.
const VOLTRON_FAMILY_IDS = new Set(['voltron', 'choosy-voltron']);

// Brief #20: shave Voltron's "|tags:..." trailer off note text before
// truncating. Voltron entries often append a metadata trailer the user
// shouldn't see in notifications.
function stripTagsTrailer(note: string): string {
  return note.split('|tags:')[0].trim();
}

function truncateNote(note: string, max: number): string {
  if (note.length <= max) return note;
  return note.slice(0, max).trimEnd() + '…';
}
import {
  appendToFeed,
  getFeedEntry,
  loadFeed,
  updateFeedLock,
  updateFeedRetryCount,
} from '@/core/storage/drop-feed';
import { setLockState } from '@/core/bungie/api';
import {
  MAX_RETRY_CYCLES,
  attemptAutoLock,
  isLockPending,
  markFirstSeen,
} from './autolock';
import {
  loadAuthState,
  loadPrimaryMembership,
  loadTokens,
  savePrimaryMembership,
  saveAuthState,
  saveBungieUser,
  type DestinyMembership,
} from '@/core/storage/tokens';
import { showNotification } from '@/adapters/notifications';
import type { ScoringConfig } from '@/core/scoring/types';
import type {
  ArmorTaxonomyPayload,
  AutolockFailedPayload,
  DropFeedEntry,
  NewItemDrop,
} from '@/shared/types';

const BASELINE_KEY = 'inventory-baseline';

// --- Sign-in -----------------------------------------------------------------

export async function handleSignIn(): Promise<void> {
  await ensureLoaded();
  log('auth', 'starting sign-in flow');
  await startLoginFlow();
  log('auth', 'tokens saved, fetching memberships');

  // GetMembershipsForCurrentUser returns destinyMemberships AND bungieNetUser
  // in one call — no need for the deprecated GetCurrentBungieUser endpoint.
  const memberships = await getMembershipsForCurrentUser();

  const bungieUser = memberships.bungieNetUser;
  saveBungieUser({
    bungieGlobalDisplayName: bungieUser?.bungieGlobalDisplayName ?? null,
    bungieGlobalDisplayNameCode: bungieUser?.bungieGlobalDisplayNameCode ?? null,
    uniqueName: bungieUser?.uniqueName ?? null,
  });

  const destinyMemberships = memberships.destinyMemberships ?? [];
  if (destinyMemberships.length === 0) {
    throw new Error('No Destiny memberships found for this Bungie account');
  }

  // Selection priority (matches the Overwolf controller):
  //   1. Cross-save host: a membership where crossSaveOverride === membershipType.
  //      For cross-save accounts this is the canonical platform Bungie expects
  //      profile queries to target.
  //   2. primaryMembershipId, if Bungie set one.
  //   3. First entry in destinyMemberships as a last resort.
  const chosen =
    destinyMemberships.find(
      (m) => m.crossSaveOverride !== 0 && m.membershipType === m.crossSaveOverride,
    ) ??
    (memberships.primaryMembershipId
      ? destinyMemberships.find((m) => m.membershipId === memberships.primaryMembershipId)
      : undefined) ??
    destinyMemberships[0];

  const primary: DestinyMembership = {
    membershipType: chosen.membershipType,
    membershipId: chosen.membershipId,
    displayName: chosen.displayName,
    iconPath: chosen.iconPath ?? null,
    crossSaveOverride: chosen.crossSaveOverride,
  };
  savePrimaryMembership(primary);
  saveAuthState('signed-in');
  log('auth', 'sign-in complete', primary.displayName);
}

export async function handleSignOut(): Promise<void> {
  await ensureLoaded();
  log('auth', 'signing out');
  await bungieLogout();
  setItem(BASELINE_KEY, null);
  saveAuthState('signed-out');
}

// --- Manifest kickoff --------------------------------------------------------

// Proactively fetch the manifest at install/startup so the options page can
// clear its first-boot loading indicator without waiting for a drop. Errors
// are swallowed — the UI's retry button covers recovery.
export async function kickoffManifestLoad(): Promise<void> {
  try {
    await getManifest();
  } catch (err) {
    logError('manifest', 'initial load failed', err instanceof Error ? err.message : err);
  }
}

export async function handleRetryManifest(): Promise<void> {
  log('manifest', 'retry requested');
  try {
    await getManifest();
  } catch (err) {
    logError('manifest', 'retry failed', err instanceof Error ? err.message : err);
  }
}

// Derive the sets/archetypes/tertiaries lists for the Rules UI. Runs in the
// SW so the options page doesn't need to hold the (large) manifest in memory.
// On manifest failure we return empty sets/archetypes rather than throwing —
// the Rules editor handles "loading" state for those, but tertiaries are
// always available from the static ARMOR_TERTIARIES constant.
export async function handleGetArmorTaxonomy(): Promise<ArmorTaxonomyPayload> {
  try {
    const manifest = await getManifest();
    return {
      sets: listArmorSets(manifest),
      archetypes: listArmorArchetypes(manifest),
      tertiaries: [...ARMOR_TERTIARIES],
    };
  } catch (err) {
    logError('taxonomy', 'get failed', err instanceof Error ? err.message : err);
    return { sets: [], archetypes: [], tertiaries: [...ARMOR_TERTIARIES] };
  }
}

// --- Poll cycle --------------------------------------------------------------

export async function handlePollAlarm(): Promise<void> {
  await ensureLoaded();
  // Wishlist cache must be warm before scoring runs. ensureWishlistCacheReady
  // is idempotent within a worker wake — first call hydrates from storage and
  // fires a background refresh of stale enabled sources; subsequent calls are
  // no-ops. The cache is read by the matcher synchronously at scoring time.
  await ensureWishlistCacheReady();

  if (!isLoggedIn()) {
    // Differentiate: tokens-but-expired (banner-worthy) vs no-tokens-yet
    // (expected state pre-sign-in). Public-client sessions hit the expired
    // branch ~1hr after sign-in since there's no refresh token.
    const tokens = loadTokens();
    if (tokens) {
      const previousState = loadAuthState();
      saveAuthState('expired');
      log('poll', 'skipping cycle — session expired');
      // Fire the OS toast only on the fresh signed-in → expired transition so
      // we don't re-notify every minute while the session stays expired. Fixed
      // notificationId means any accidental re-fire replaces rather than stacks.
      if (previousState !== 'expired') {
        void showNotification({
          title: 'Cryptarch session expired',
          message: 'Sign in again to resume drop tracking.',
          notificationId: 'cryptarch-session-expired',
        });
      }
    } else {
      log('poll', 'skipping cycle — not signed in');
    }
    return;
  }
  const primary = loadPrimaryMembership();
  if (!primary) {
    log('poll', 'skipping cycle — no primary membership');
    return;
  }

  const startedAt = Date.now();
  const baseline = getItem<BaselineMap>(BASELINE_KEY);
  logJson('poll', 'start', {
    hasBaseline: baseline !== null,
    baselineSize: baseline ? Object.keys(baseline).length : 0,
    membershipType: primary.membershipType,
  });

  try {
    const result = await runPollCycle(primary.membershipType, primary.membershipId, baseline);

    setItem(BASELINE_KEY, result.updatedBaseline);

    logJson('poll', 'complete', {
      isBaselineCycle: result.isBaselineCycle,
      itemsKnown: result.itemsKnown,
      newDrops: result.newDrops.length,
      ms: Date.now() - startedAt,
    });

    if (result.isBaselineCycle) return;

    if (result.newDrops.length > 0) {
      await handleNewDrops(result.newDrops);
    }

    if (result.confirmedDeletions.length > 0) {
      await handleConfirmedDeletions(result.confirmedDeletions);
    }

    // Retry any entries still stuck on a prior cycle's 1623. Runs every poll
    // tick even if there were no new drops this cycle — 1623 typically clears
    // within a minute or two once Bungie's backend "settles" the new item.
    await retryPendingAutolocks();
  } catch (err) {
    logError('poll', 'cycle error', err instanceof Error ? err.message : err);
  }
}

// --- New-drop processing -----------------------------------------------------

async function handleNewDrops(drops: NewItemDrop[]): Promise<void> {
  // Flap suppression: if the feed already has this instanceId, skip it. Bungie's
  // profile API is eventually-consistent and items can briefly drop out then
  // reappear; without this guard we'd re-score and re-broadcast the same drop.
  const filtered: NewItemDrop[] = [];
  const alreadySeen: string[] = [];
  for (const d of drops) {
    if (getFeedEntry(d.instanceId)) alreadySeen.push(d.instanceId);
    else filtered.push(d);
  }
  if (alreadySeen.length > 0) {
    logJson('drops', 'filtered already-seen', {
      count: alreadySeen.length,
      ids: alreadySeen,
    });
  }
  if (filtered.length === 0) return;

  const config = loadScoringConfig();
  config.armorRules = loadArmorRules();
  // Brief #11 Part D: scoring no longer needs config.wishlists — the matcher
  // reads from the wishlist cache directly, hydrated above by
  // ensureWishlistCacheReady().

  // Manifest + enhancedPerkMap are needed by the scoring engine. If the manifest
  // hasn't downloaded yet we fall back to an empty map — weapon wishlist
  // matches will underperform for one cycle but armor scoring is unaffected.
  // Brief #14 Part D: capture the manifest version too, stamped onto each
  // entry below so the expand view can label "captured against v[X]" later.
  let enhancedPerkMap = new Map<number, number>();
  let manifestVersion: string | undefined;
  try {
    const manifest = await getManifest();
    manifestVersion = manifest.version;
    enhancedPerkMap = await getEnhancedPerkMap();
  } catch (err) {
    logError('scoring', 'manifest load failed; scoring with empty perk map', err);
  }

  for (const drop of filtered) {
    const result = scoreItem(drop, config, enhancedPerkMap);
    logJson('scoring', 'scored', {
      instanceId: drop.instanceId,
      name: drop.name,
      matchCount: result.wishlistMatches.length,
      armorMatched: result.armorMatched,
      excluded: result.excluded,
      reasons: result.reasons,
    });

    if (result.excluded) continue;

    // Brief #14.3 Bug 1: ask the perk-pool resolver which sockets count as
    // perk columns for this weapon, then filter drop.perks to exactly those
    // socket indices. Result: perkIcons.length matches the snapshot's
    // columns.length precisely — collapsed row icon count tracks the
    // weapon's actual column count instead of an arbitrary slice. Side
    // benefit: getCachedPerkPool populates the SW cache, so the user's
    // first click-to-expand on this drop is a memory-cache hit.
    let perkSocketIndices: Set<number> | null = null;
    try {
      const snapshot = await getCachedPerkPool(drop.itemHash);
      if (snapshot) {
        perkSocketIndices = new Set(snapshot.columns.map((c) => c.socketIndex));
      }
    } catch (err) {
      logError('scoring', 'perk pool resolve failed at capture', err);
    }
    // Fallback when the resolver couldn't help (manifest unavailable, weapon
    // hash absent, no random-roll columns): take the first 6 sockets with
    // icons. This loses the precise column-count guarantee but keeps capture
    // working for edge-case items.
    const renderablePerks = perkSocketIndices
      ? drop.perks.filter((p) => perkSocketIndices!.has(p.columnIndex) && p.plugIcon.length > 0)
      : drop.perks.slice(0, 6).filter((p) => p.plugIcon.length > 0);

    // Brief #14 Part B: build perkIcons + perkHashes as parallel arrays.
    // Hash is canonicalized via enhancedPerkMap so render-side membership
    // checks against WishlistMatch.taggedPerkHashes match regardless of
    // which form the wishlist source used.
    //
    // Brief #14.3 Bug 4: also build unlockedPerksPerColumn from each
    // socket's unlockedPlugHashes (set of unlocked alternatives, populated
    // in inventory.ts buildDrops). For non-crafted weapons each column's
    // unlocked set is just [equipped]; for crafted weapons it includes
    // every shaped alternative. Renderers use this to mark a column as
    // "keeper-capable" if any unlocked perk in it is wishlist-tagged.
    const perkIcons = renderablePerks.map((p) => p.plugIcon);
    const canon = (h: number) => enhancedPerkMap.get(h) ?? h;
    const perkHashes = renderablePerks.map((p) => canon(p.plugHash));
    // Brief #14.4: socket-indexed map is the source of truth going forward.
    // perkIcons + perkHashes (parallel arrays) stay populated for renderers
    // that haven't migrated to the display model yet.
    const unlockedPerksBySocketIndex: Record<number, number[]> = {};
    for (const p of renderablePerks) {
      unlockedPerksBySocketIndex[p.columnIndex] = (
        p.unlockedPlugHashes ?? [p.plugHash]
      ).map(canon);
    }
    // Brief #14.5 + #19 + #21: capture the godroll-perk union for this
    // weapon. Display layer gold-borders any of these. Filter by Charles
    // minTier so exhaustive secondary sources don't flood low-tier weapons.
    // Brief #21: also restrict to Charles-only when voltronConfirmation is
    // on — the principle is "Charles is the appraiser; Voltron decorates."
    // Custom notification-only sources are always excluded inside
    // collectWeaponGodrolls.
    const charlesConfigForGodrolls = loadCharlesSourceConfig();
    const filterConfigForGodrolls = loadWeaponFilterConfig();
    const weaponGodrollHashes = collectWeaponGodrolls(
      drop.itemHash,
      charlesConfigForGodrolls.minTier,
      filterConfigForGodrolls.voltronConfirmation,
    ).map(canon);
    // Canonicalize taggedPerkHashes the same way. Wishlist sources mostly use
    // base hashes already, but a source listing an enhanced perk would get
    // misaligned without this — cheap defense-in-depth.
    const canonicalizedMatches = result.wishlistMatches.map((m) =>
      m.taggedPerkHashes
        ? {
            ...m,
            taggedPerkHashes: m.taggedPerkHashes.map(
              (h) => enhancedPerkMap.get(h) ?? h,
            ),
          }
        : m,
    );

    const entry: DropFeedEntry = {
      instanceId: drop.instanceId,
      itemHash: drop.itemHash,
      itemName: drop.name,
      itemIcon: drop.iconUrl,
      itemType: drop.itemTypeEnum === 2 ? 'armor' : 'weapon',
      timestamp: drop.detectedAt,
      locked: false,
      perkIcons,
      perkHashes,
      unlockedPerksBySocketIndex,
      weaponGodrollHashes:
        weaponGodrollHashes.length > 0 ? weaponGodrollHashes : undefined,
      weaponType: drop.itemTypeEnum === 3 ? drop.itemSubType : null,
      armorMatched: result.armorMatched,
      armorClass: result.armorRoll?.armorClass ?? null,
      armorSet: result.armorRoll?.setName ?? null,
      armorArchetype: result.armorRoll?.archetype ?? null,
      armorTertiary: result.armorRoll?.tertiaryStat?.name ?? null,
      armorTier: result.armorRoll?.tier === 4 || result.armorRoll?.tier === 5
        ? result.armorRoll.tier
        : null,
      isExotic: drop.tierType === 'Exotic',
      characterId: drop.characterId,
      // Omit the field entirely when there are no matches so legacy entries
      // (pre-#11) and no-match entries render identically through optional
      // chaining downstream. UI treats absent and empty as equivalent.
      wishlistMatches: canonicalizedMatches.length > 0 ? canonicalizedMatches : undefined,
      // Brief #12: best tier across this drop's matches, resolved once at
      // capture time so renderers and the notification filter don't recompute.
      // Absent when no match has tier data (Voltron-only drops, custom URLs).
      weaponTier:
        result.wishlistMatches.length > 0
          ? resolveBestTier(result.wishlistMatches)
          : undefined,
      // Brief #14 Part D: omitted when manifest load failed (rare). The
      // expand-view disclaimer treats absence as "no era info available."
      manifestVersion,
    };
    appendToFeed(entry);
    markFirstSeen(entry.instanceId, drop.detectedAt);
    maybeNotify(entry, false);
    if (shouldAutoLock(entry, config)) {
      void handleAutoLock(entry);
    }
  }

  logJson('drops', 'processed cycle', {
    total: drops.length,
    afterFlapSuppression: filtered.length,
  });
}

// --- Notification trigger ----------------------------------------------------

// Brief #12 Part H removed weaponGradeMeetsThreshold and its GRADE_RANK
// supporting constant — the legacy grade-based notification threshold no
// longer gates weapon notifications. WeaponFilterConfig (tier + roll-type)
// from the Weapons tab does, applied inside maybeNotify directly.

// Priority: exotic > armor match > weapon match. First matching rule wins — a
// single drop fires at most one toast. instanceId is the notificationId so any
// later call for the same drop (flap re-detection, or autolock "(locked)"
// suffix update) replaces rather than stacks.
function maybeNotify(entry: DropFeedEntry, locked: boolean): void {
  let title: string | null = null;
  let message: string | null = null;

  if (entry.isExotic) {
    title = `Exotic dropped: ${entry.itemName}`;
    message = `${entry.itemType === 'armor' ? 'Armor' : 'Weapon'} — check inventory`;
  } else if (entry.itemType === 'armor' && entry.armorMatched === true) {
    title = `Armor match: ${entry.itemName}`;
    const bits = [entry.armorSet, entry.armorArchetype, entry.armorTertiary].filter(
      (b): b is string => !!b,
    );
    message = bits.length > 0 ? bits.join(' / ') : 'Rule match';
  } else if (entry.itemType === 'weapon') {
    // Brief #20 + #21: notification copy reflects Charles-as-primary plus
    // the new notification-only custom-source mode. Branches:
    //   - Charles matched → "<Tier>-Tier <Weapon>"; body = trimmed Charles
    //     note. Append " · Voltron confirmed" when applicable, then
    //     " · Also flagged by <name>" for any notification-only co-matches.
    //   - Voltron-family only → "Voltron keeper: <Weapon>".
    //   - Notification-only sources are the only signal → generic
    //     "Wishlist match: <Weapon>" with custom source names; no tier
    //     prefix (custom URLs aren't authoritative tier sources).
    //   - Other built-in source matched (deprecated Aegis re-enabled, etc.) →
    //     same generic "Wishlist match: <Weapon>" path. Rare.
    const matches = entry.wishlistMatches ?? [];
    if (matches.length === 0) return;

    const charlesMatch = matches.find((m) => m.sourceId === CHARLES_SOURCE_ID);
    const voltronConfirmed = matches.some((m) => m.confirmsCharles === true);
    const notificationOnlyMatches = matches.filter(
      (m) => m.notificationOnly === true,
    );
    const visibleMatches = matches.filter((m) => m.notificationOnly !== true);
    const weaponLabel = entry.weaponType ?? 'Weapon';

    if (charlesMatch) {
      const tier = entry.weaponTier ?? charlesMatch.weaponTier;
      title = tier ? `${tier}-Tier ${entry.itemName}` : `Wishlist match: ${entry.itemName}`;
      const baseNote = charlesMatch.notes
        ? truncateNote(stripTagsTrailer(charlesMatch.notes), 80)
        : weaponLabel;
      const suffixes: string[] = [];
      if (voltronConfirmed) suffixes.push('Voltron confirmed');
      if (notificationOnlyMatches.length > 0) {
        const names = notificationOnlyMatches.map((m) => m.sourceName).join(', ');
        suffixes.push(`Also flagged by ${names}`);
      }
      message = suffixes.length > 0 ? `${baseNote} · ${suffixes.join(' · ')}` : baseNote;
    } else {
      const voltronMatch = visibleMatches.find((m) => VOLTRON_FAMILY_IDS.has(m.sourceId));
      if (voltronMatch) {
        title = `Voltron keeper: ${entry.itemName}`;
        message = voltronMatch.notes
          ? truncateNote(stripTagsTrailer(voltronMatch.notes), 80)
          : weaponLabel;
      } else if (visibleMatches.length > 0) {
        // Some other built-in source matched (deprecated Aegis manually
        // re-enabled, etc.). Generic copy with source names.
        title = `Wishlist match: ${entry.itemName}`;
        message = visibleMatches.map((m) => m.sourceName).join(', ');
      } else {
        // Only notification-only sources matched — custom URLs producing
        // a dark-data alert. No tier authority, no curator decoration.
        title = `Wishlist match: ${entry.itemName}`;
        message = notificationOnlyMatches.map((m) => m.sourceName).join(', ');
      }
    }
  }

  if (!title || !message) return;
  if (locked) message = `${message} (locked)`;

  void showNotification({
    title,
    message,
    iconUrl: entry.itemIcon,
    notificationId: entry.instanceId,
  }).catch(() => {
    // Already logged inside the adapter; swallow so a failed toast doesn't
    // bubble up and kill the rest of the poll cycle.
  });
}

// --- Deletion handling -------------------------------------------------------

// For each confirmed deletion: flip the existing feed entry to deleted state
// (if we already scored this item as a drop), or create a new "ghost" feed
// entry using manifest data (if the item predates our observation window).
// In both cases the timestamp is set to now so deleted items surface at the
// top of the feed when the user scrolls to see what just happened.
async function handleConfirmedDeletions(deletions: DeletedItem[]): Promise<void> {
  logJson('deletion', 'confirmed', { count: deletions.length });

  let manifest: Awaited<ReturnType<typeof getManifest>> | null = null;

  for (const d of deletions) {
    const existing = getFeedEntry(d.instanceId);
    if (existing) {
      const updated: DropFeedEntry = {
        ...existing,
        deleted: true,
        timestamp: Date.now(),
      };
      appendToFeed(updated);
      continue;
    }

    // Ghost entry path — we never saw this item as a scored drop. Look up
    // the manifest def to render a meaningful row.
    if (!manifest) {
      try {
        manifest = await getManifest();
      } catch (err) {
        logError('deletion', 'manifest load failed; skipping ghost entries', err);
        return;
      }
    }
    const def = manifest.definitions.DestinyInventoryItemDefinition[d.itemHash];
    if (!def) continue;
    const itemTypeEnum = def.itemType;
    // Only weapons (3) and armor (2). Skip everything else.
    if (itemTypeEnum !== 2 && itemTypeEnum !== 3) continue;
    const tierType = def.inventory?.tierType;
    // Skip common/basic whites — they'd flood the feed with noise.
    if (tierType === 2 || tierType === 3) continue;

    const iconPath = def.displayProperties?.icon;
    const ghost: DropFeedEntry = {
      instanceId: d.instanceId,
      itemName: def.displayProperties?.name || `Item ${d.itemHash}`,
      itemIcon: iconPath ? `https://www.bungie.net${iconPath}` : '',
      itemType: itemTypeEnum === 2 ? 'armor' : 'weapon',
      timestamp: Date.now(),
      locked: false,
      perkIcons: [],
      weaponType: null,
      armorMatched: null,
      armorClass: null,
      armorSet: null,
      armorArchetype: null,
      armorTertiary: null,
      armorTier: null,
      isExotic: tierType === 6,
      deleted: true,
    };
    appendToFeed(ghost);
  }
}

// --- Autolock ----------------------------------------------------------------

// Target logic per Brief #8 Part B (predicate updated in Brief #12.5 Part C
// after grade was retired from the data layer):
//   Weapon, any wishlist match, NOT exotic → lock
//   Weapon, exotic                          → never (toast still fires)
//   Armor, ruleMatched, tier 4+, !exotic    → lock if autoLockOnArmorMatch
//   Armor, ruleMatched, exotic              → lock if autoLockOnArmorMatch
//
// Pre-#12.5 the weapon predicate was `entry.grade === 'S' && !entry.isExotic`.
// Grade S meant "any enabled wishlist flagged this roll as a keeper", so the
// new predicate (wishlistMatches.length > 0) preserves the same behavior
// while reading the canonical signal directly.
function shouldAutoLock(entry: DropFeedEntry, config: ScoringConfig): boolean {
  if (entry.itemType === 'weapon') {
    return (entry.wishlistMatches?.length ?? 0) > 0 && !entry.isExotic;
  }
  // armor
  if (!entry.armorMatched) return false;
  if (!config.autoLockOnArmorMatch) return false;
  if (entry.isExotic) return true;
  return entry.armorTier === 4 || entry.armorTier === 5;
}

async function handleAutoLock(entry: DropFeedEntry): Promise<void> {
  // Feed-locked check is the canonical guard — survives SW restarts unlike
  // the in-memory pendingLocks set.
  const current = getFeedEntry(entry.instanceId);
  if (current?.locked) return;
  if (isLockPending(entry.instanceId)) return;
  if (!entry.characterId) {
    logError('autolock', 'missing characterId on feed entry', entry.instanceId);
    return;
  }

  const currentCount = current?.retryCycleCount ?? 0;
  if (currentCount >= MAX_RETRY_CYCLES) return;

  const primary = loadPrimaryMembership();
  if (!primary) return;

  const isFirstAttempt = currentCount === 0;
  const result = await attemptAutoLock({
    instanceId: entry.instanceId,
    itemName: entry.itemName,
    membershipType: primary.membershipType,
    characterId: entry.characterId,
    cycleAttempt: currentCount + 1,
    setLockState,
  });

  if (result.kind === 'skipped-pending') return;

  if (result.kind === 'success') {
    updateFeedLock(entry.instanceId, true);
    // Only re-fire the toast on the first-attempt success so the user isn't
    // re-notified on cross-cycle retries that eventually land.
    if (isFirstAttempt) {
      const updatedEntry = { ...entry, locked: true };
      maybeNotify(updatedEntry, true);
    }
    return;
  }

  // Persist the incremented attempt count so the retry state survives SW
  // death between poll cycles.
  const newCount = currentCount + 1;
  updateFeedRetryCount(entry.instanceId, newCount);

  const exhausted =
    result.kind === 'failed' ||
    (result.kind === 'retryable' && newCount >= MAX_RETRY_CYCLES);

  if (exhausted) {
    broadcastAutolockFailed(entry);
  }
  // Otherwise: retryable and still under cap — retryPendingAutolocks picks it
  // up on the next poll cycle.
}

function broadcastAutolockFailed(entry: DropFeedEntry): void {
  const payload: AutolockFailedPayload = {
    itemName: entry.itemName,
    instanceId: entry.instanceId,
    at: Date.now(),
  };
  setItem('autolock.failed.last', payload);
  logJson('autolock', 'gave up after retries', payload);
}

// Scan the feed for entries that still want to be autolocked after a prior
// cycle's 1623 failure. Called from handlePollAlarm after new drops are
// processed so first-attempts and retries run in the same poll tick.
export async function retryPendingAutolocks(): Promise<void> {
  const config = loadScoringConfig();
  config.armorRules = loadArmorRules();
  // Brief #11 Part D: see comment in handlePollAlarm. Matcher reads from cache.
  const feed = loadFeed();
  const candidates = feed.filter((entry) => {
    if (entry.locked) return false;
    if (entry.deleted) return false; // no point locking an item that's gone
    const count = entry.retryCycleCount ?? 0;
    if (count === 0) return false; // first attempt — already tried synchronously on detection
    if (count >= MAX_RETRY_CYCLES) return false;
    if (!entry.characterId) return false;
    return shouldAutoLock(entry, config);
  });
  if (candidates.length === 0) return;
  logJson('autolock', 'retrying stuck entries', { count: candidates.length });
  for (const entry of candidates) {
    await handleAutoLock(entry);
  }
}
