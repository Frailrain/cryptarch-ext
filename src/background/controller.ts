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
import {
  runPollCycle,
  type BaselineMap,
} from '@/core/bungie/inventory';
import { scoreItem } from '@/core/scoring/engine';
import { loadArmorRules } from '@/core/rules/armor-rules';
import {
  loadScoringConfig,
  loadWishlists,
} from '@/core/storage/scoring-config';
import { appendToFeed, getFeedEntry } from '@/core/storage/drop-feed';
import {
  loadPrimaryMembership,
  savePrimaryMembership,
  saveBungieUser,
  type DestinyMembership,
} from '@/core/storage/tokens';
import type { DropFeedEntry, NewItemDrop } from '@/shared/types';

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
  log('auth', 'sign-in complete', primary.displayName);
}

export async function handleSignOut(): Promise<void> {
  await ensureLoaded();
  log('auth', 'signing out');
  await bungieLogout();
  setItem(BASELINE_KEY, null);
}

// --- Poll cycle --------------------------------------------------------------

export async function handlePollAlarm(): Promise<void> {
  await ensureLoaded();

  if (!isLoggedIn()) {
    log('poll', 'skipping cycle — not signed in');
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
    if (result.newDrops.length === 0) return;

    await handleNewDrops(result.newDrops);
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
  config.wishlists = loadWishlists();

  // Manifest + enhancedPerkMap are needed by the scoring engine. If the manifest
  // hasn't downloaded yet we fall back to an empty map — weapon wishlist
  // matches will underperform for one cycle but armor scoring is unaffected.
  let enhancedPerkMap = new Map<number, number>();
  try {
    await getManifest();
    enhancedPerkMap = await getEnhancedPerkMap();
  } catch (err) {
    logError('scoring', 'manifest load failed; scoring with empty perk map', err);
  }

  for (const drop of filtered) {
    const result = scoreItem(drop, config, enhancedPerkMap);
    logJson('scoring', 'scored', {
      instanceId: drop.instanceId,
      name: drop.name,
      grade: result.grade,
      armorMatched: result.armorMatched,
      excluded: result.excluded,
      reasons: result.reasons,
    });

    if (result.excluded) continue;

    const entry: DropFeedEntry = {
      instanceId: drop.instanceId,
      itemName: drop.name,
      itemIcon: drop.iconUrl,
      itemType: drop.itemTypeEnum === 2 ? 'armor' : 'weapon',
      grade: result.grade,
      timestamp: drop.detectedAt,
      locked: false,
      perkIcons: drop.perks
        .slice(0, 4)
        .map((p) => p.plugIcon)
        .filter((i) => i.length > 0),
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
    };
    appendToFeed(entry);
  }

  logJson('drops', 'processed cycle', {
    total: drops.length,
    afterFlapSuppression: filtered.length,
  });
}
