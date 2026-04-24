// Autolock state + single-attempt dispatch. Ported from Overwolf with one big
// shape change: no in-loop setTimeout retries (a MV3 service worker can die
// between setTimeout callbacks). Instead, the controller retries across poll
// cycles using DropFeedEntry.retryCycleCount as the canonical counter.
//
// In-memory state caveats (per Brief #8 Part B):
//   - pendingLocks: dedupe for the same-poll-cycle case. Lost on SW death —
//     acceptable because the persistent feed-locked check is the canonical
//     "already locked" guard.
//   - firstSeenAt: diagnostic-only (msSinceDetection logging). Losing it
//     across worker death means some diagnostic numbers show -1; we don't
//     engineer persistence for it.

import { BungieApiError } from '@/core/bungie/types';
import type { SetLockStateOutcome } from '@/core/bungie/api';
import { logJson } from '@/adapters/logger';

export const RETRY_ERROR_CODE = 1623;
export const MAX_RETRY_CYCLES = 3;

const pendingLocks = new Set<string>();
const firstSeenAt = new Map<string, number>();

export function markFirstSeen(instanceId: string, at: number = Date.now()): void {
  if (!firstSeenAt.has(instanceId)) {
    firstSeenAt.set(instanceId, at);
  }
}

export function isLockPending(instanceId: string): boolean {
  return pendingLocks.has(instanceId);
}

function msSinceDetection(instanceId: string): number {
  const t = firstSeenAt.get(instanceId);
  return t === undefined ? -1 : Date.now() - t;
}

export type SetLockStateFn = (
  membershipType: number,
  characterId: string,
  itemId: string,
  locked: boolean,
) => Promise<SetLockStateOutcome>;

export interface AttemptAutoLockCtx {
  instanceId: string;
  itemName: string;
  membershipType: number;
  characterId: string;
  cycleAttempt: number; // 1 for first call, 2–3 for retries
  setLockState: SetLockStateFn;
}

export type AutoLockStatus =
  | { kind: 'success'; outcome: SetLockStateOutcome }
  | { kind: 'retryable'; errorCode: number; errorStatus: string }
  | { kind: 'failed'; errorCode: number | null; errorStatus: string }
  | { kind: 'skipped-pending' };

// Dispatch a single SetLockState POST. Caller decides what to do on 'retryable'
// — typically bump retryCycleCount on the feed entry and try again next poll.
export async function attemptAutoLock(ctx: AttemptAutoLockCtx): Promise<AutoLockStatus> {
  if (pendingLocks.has(ctx.instanceId)) {
    return { kind: 'skipped-pending' };
  }
  pendingLocks.add(ctx.instanceId);

  const postedAt = Date.now();
  logJson('autolock', 'attempt', {
    instanceId: ctx.instanceId,
    itemName: ctx.itemName,
    membershipType: ctx.membershipType,
    characterId: ctx.characterId,
    cycleAttempt: ctx.cycleAttempt,
    msSinceDetection: msSinceDetection(ctx.instanceId),
  });

  try {
    const outcome = await ctx.setLockState(
      ctx.membershipType,
      ctx.characterId,
      ctx.instanceId,
      true,
    );
    logJson('autolock', 'result', {
      instanceId: ctx.instanceId,
      ok: true,
      outcome,
      msFromPost: Date.now() - postedAt,
      cycleAttempt: ctx.cycleAttempt,
    });
    return { kind: 'success', outcome };
  } catch (err) {
    const isApiErr = err instanceof BungieApiError;
    const errorCode = isApiErr ? err.errorCode : null;
    const errorStatus = isApiErr
      ? err.errorStatus
      : err instanceof Error
        ? err.message
        : String(err);

    logJson('autolock', 'result', {
      instanceId: ctx.instanceId,
      ok: false,
      errorCode,
      errorStatus,
      msFromPost: Date.now() - postedAt,
      cycleAttempt: ctx.cycleAttempt,
    });

    if (errorCode === RETRY_ERROR_CODE) {
      return { kind: 'retryable', errorCode, errorStatus };
    }
    return { kind: 'failed', errorCode, errorStatus };
  } finally {
    pendingLocks.delete(ctx.instanceId);
  }
}
