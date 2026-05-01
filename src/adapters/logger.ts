// Structured log helpers. The Overwolf version sprinkled console.log with
// bracketed tags like [poll], [drops], [scoring], [autolock] throughout the
// codebase. We preserve the same prefixes so service-worker devtools debugging
// looks identical to the Overwolf build.

export type LogTag =
  | 'poll'
  | 'drops'
  | 'scoring'
  | 'autolock'
  | 'auth'
  | 'inventory'
  | 'manifest'
  | 'armor-roll'
  | 'wishlist'
  | 'bungieRequest'
  | 'sw'
  | 'notify'
  | 'taxonomy'
  | 'deletion';

export function log(tag: LogTag, ...args: unknown[]): void {
  console.log(`[${tag}]`, ...args);
}

export function warn(tag: LogTag, ...args: unknown[]): void {
  console.warn(`[${tag}]`, ...args);
}

export function error(tag: LogTag, ...args: unknown[]): void {
  console.error(`[${tag}]`, ...args);
}

export function logJson(tag: LogTag, event: string, payload: unknown): void {
  console.log(`[${tag}] ${event}`, JSON.stringify(payload));
}
