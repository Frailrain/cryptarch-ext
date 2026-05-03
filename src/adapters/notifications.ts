// chrome.notifications wrapper. The native API is callback-based and a bit
// fiddly (iconUrl is required on type=basic, no built-in dedupe field — re-using
// notificationId replaces the existing notification of that ID).
//
// Call sites in controller.ts pass entry.instanceId as notificationId so a flap
// re-detection of the same drop collapses to a single OS toast rather than
// stacking duplicates.

import { log, logJson, error as logError } from './logger';

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
  // Brief #23: optional action buttons. Drop notifications attach a single
  // "Lock" button when auto-lock is disabled, wired via
  // chrome.notifications.onButtonClicked in the SW. Chrome's max is 2 buttons.
  buttons?: chrome.notifications.ButtonOptions[];
}

export async function showNotification(opts: ShowNotificationOptions): Promise<string> {
  const options: chrome.notifications.NotificationOptions<true> = {
    type: 'basic',
    title: opts.title,
    message: opts.message,
    iconUrl: opts.iconUrl ?? FALLBACK_ICON_URL,
  };
  if (opts.buttons && opts.buttons.length > 0) {
    options.buttons = opts.buttons;
  }

  const notificationId = opts.notificationId ?? crypto.randomUUID();
  logJson('notify', 'chrome.notifications.create called', {
    id: notificationId,
    title: opts.title,
    hasButtons: !!options.buttons,
  });

  try {
    // The @types/chrome typedef declares all chrome.notifications.create
    // overloads as returning void (callback-based). At runtime MV3 returns
    // Promise<string>, but the typedef hasn't caught up. Wrap the callback
    // form in a Promise manually so the type comes through correctly.
    // Always passing an explicit notificationId (generated if caller didn't
    // supply one) keeps dedupe semantics consistent — same id arg means
    // replacing an existing notification, fresh uuid means a new one.
    const id = await new Promise<string>((resolve) => {
      chrome.notifications.create(notificationId, options, (createdId) => {
        // Brief #23: chrome.runtime.lastError surfaces silent failures
        // (missing icon, denied permission, malformed payload) that would
        // otherwise leave the notification invisible without trace.
        const lastError = chrome.runtime.lastError?.message ?? null;
        logJson('notify', 'chrome.notifications.create callback', {
          id: createdId,
          success: !!createdId && !lastError,
          lastError,
        });
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

// Brief #23: log chrome.notifications.getPermissionLevel at SW wake so we can
// see permission state in the SW console without having to manually probe.
// On Windows, OS-level Focus Assist / "Do Not Disturb" can suppress toasts
// even when getPermissionLevel returns 'granted', so a 'granted' here doesn't
// guarantee delivery — but a 'denied' definitively explains a no-show.
export function logNotificationPermissionLevel(): void {
  chrome.notifications.getPermissionLevel((level) => {
    log('notify', 'permission level', level);
  });
}
