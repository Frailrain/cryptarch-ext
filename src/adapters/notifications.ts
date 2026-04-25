// chrome.notifications wrapper. The native API is callback-based and a bit
// fiddly (iconUrl is required on type=basic, no built-in dedupe field — re-using
// notificationId replaces the existing notification of that ID).
//
// Call sites in controller.ts pass entry.instanceId as notificationId so a flap
// re-detection of the same drop collapses to a single OS toast rather than
// stacking duplicates.

import { logJson, error as logError } from './logger';

// 1x1 transparent PNG. chrome.notifications.create rejects type=basic without
// a loadable iconUrl; this is the absolute fallback for code paths that don't
// supply one. Drop notifications always pass the Bungie item icon, so this is
// only used by ad-hoc test calls and any future caller that forgets one.
const FALLBACK_ICON_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export interface ShowNotificationOptions {
  title: string;
  message: string;
  iconUrl?: string;
  // Re-using a notificationId replaces the existing notification with that ID
  // (no separate "tag" concept in chrome.notifications). Default to a random
  // ID; pass instanceId for per-drop dedupe.
  notificationId?: string;
}

export async function showNotification(opts: ShowNotificationOptions): Promise<string> {
  const options: chrome.notifications.NotificationOptions<true> = {
    type: 'basic',
    title: opts.title,
    message: opts.message,
    iconUrl: opts.iconUrl ?? FALLBACK_ICON_URL,
  };

  try {
    // The @types/chrome typedef declares all chrome.notifications.create
    // overloads as returning void (callback-based). At runtime MV3 returns
    // Promise<string>, but the typedef hasn't caught up. Wrap the callback
    // form in a Promise manually so the type comes through correctly.
    // Always passing an explicit notificationId (generated if caller didn't
    // supply one) keeps dedupe semantics consistent — same id arg means
    // replacing an existing notification, fresh uuid means a new one.
    const notificationId = opts.notificationId ?? crypto.randomUUID();
    const id = await new Promise<string>((resolve) => {
      chrome.notifications.create(notificationId, options, (createdId) => {
        resolve(createdId);
      });
    });
    logJson('notify', 'shown', { id, title: opts.title });
    return id;
  } catch (err) {
    logError('notify', 'create failed', err);
    throw err;
  }
}
