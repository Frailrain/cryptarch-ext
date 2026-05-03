// Brief #23: master auto-lock toggle. Stored under its own key (separate from
// scoring-config's armor-specific autoLockOnArmorMatch) so the controller can
// short-circuit every autolock path — first-attempt and cross-cycle retry —
// with a single read. Default OFF: notifications carry an explicit Lock action
// button instead of firing SetLockState automatically. Persisted via the
// shared storage adapter, which prefixes keys with `cryptarch:` — full storage
// key is `cryptarch:settings.autoLock`.

import { getItem, setItem } from '@/adapters/storage';

export const AUTO_LOCK_KEY = 'settings.autoLock';

export function loadAutoLockEnabled(): boolean {
  return getItem<boolean>(AUTO_LOCK_KEY) ?? false;
}

export function saveAutoLockEnabled(value: boolean): void {
  setItem(AUTO_LOCK_KEY, value);
}
