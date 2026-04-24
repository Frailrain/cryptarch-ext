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
      sendResponse({ ok: false, error: `unknown message ${msg.type}` });
    } catch (err) {
      logError('sw', 'message handler error', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep sendResponse open for async reply
});

log('sw', 'service worker loaded');
