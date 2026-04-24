import type { DropFeedEntry } from '@/shared/types';
import { getItem, setItem } from '@/adapters/storage';

const KEY = 'drop-feed';
const MAX_ENTRIES = 200;

function readAll(): DropFeedEntry[] {
  return getItem<DropFeedEntry[]>(KEY) ?? [];
}

function writeAll(entries: DropFeedEntry[]): void {
  setItem(KEY, entries);
}

export function loadFeed(): DropFeedEntry[] {
  return readAll();
}

export function appendToFeed(entry: DropFeedEntry): void {
  const all = readAll();
  const existingIdx = all.findIndex((e) => e.instanceId === entry.instanceId);
  if (existingIdx >= 0) {
    const existing = all[existingIdx];
    all[existingIdx] = {
      ...entry,
      timestamp: existing.timestamp,
      locked: existing.locked || entry.locked,
    };
  } else {
    all.unshift(entry);
    if (all.length > MAX_ENTRIES) all.length = MAX_ENTRIES;
  }
  writeAll(all);
}

export function feedEntryLocked(instanceId: string): boolean {
  const entry = readAll().find((e) => e.instanceId === instanceId);
  return entry?.locked === true;
}

export function getFeedEntry(instanceId: string): DropFeedEntry | undefined {
  return readAll().find((e) => e.instanceId === instanceId);
}

export function updateFeedLock(instanceId: string, locked: boolean): boolean {
  const all = readAll();
  const idx = all.findIndex((e) => e.instanceId === instanceId);
  if (idx === -1) return false;
  if (all[idx].locked === locked) return false;
  all[idx] = { ...all[idx], locked };
  writeAll(all);
  return true;
}

export function updateFeedRetryCount(instanceId: string, count: number): boolean {
  const all = readAll();
  const idx = all.findIndex((e) => e.instanceId === instanceId);
  if (idx === -1) return false;
  all[idx] = { ...all[idx], retryCycleCount: count };
  writeAll(all);
  return true;
}
