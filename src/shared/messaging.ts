// Chrome extension message bus. Replaces Overwolf's window-to-window
// sendMessage with chrome.runtime.sendMessage. For broadcast-style events
// (drop-scored, drop-lock-updated) we prefer chrome.storage.onChanged:
// writing to chrome.storage automatically fans out to any listening page
// (options, popup) so we don't need to maintain a list of window targets.

export type MessageType =
  | 'auth-start'
  | 'auth-logout'
  | 'force-rebaseline'
  | 'get-armor-taxonomy'
  | 'retry-manifest'
  | 'trigger-poll-now'
  | 'wishlist-test-multi-source'
  | 'wishlist-test-fallback'
  | 'wishlist-test-armor'
  | 'lock-drop'
  // Brief #12.5 Part D: dashboard delegates all wishlist mutations to the SW.
  // Settings page is a viewer; the SW owns fetching/parsing/persisting.
  | 'wishlists:refreshOne'
  | 'wishlists:validateUrl'
  | 'wishlists:dropSource';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export function send<T = unknown>(message: Message): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      // swallow "Receiving end does not exist" noise when nothing is listening
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((response as T) ?? null);
    });
  });
}

export function onMessage(
  handler: (msg: Message, sender: chrome.runtime.MessageSender) => void | Promise<unknown>,
): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const result = handler(msg as Message, sender);
    if (result instanceof Promise) {
      result.then((r) => sendResponse(r)).catch((err) => sendResponse({ error: String(err) }));
      return true; // keep sendResponse channel open
    }
    return false;
  });
}
