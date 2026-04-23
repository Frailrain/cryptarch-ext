// Chrome identity OAuth flow. Replaces the Overwolf/GitHub-Pages shim entirely.
// chrome.identity.launchWebAuthFlow opens the auth URL in a Chrome-managed
// window and waits for a redirect to https://<extension-id>.chromiumapp.org/.
// That redirect URI must be registered in Bungie's developer portal for the
// extension's OAuth client.

import { log, error as logError } from './logger';

export function getRedirectUri(): string {
  // chrome.identity.getRedirectURL() without arg returns https://<ext-id>.chromiumapp.org/
  // (no trailing path). Bungie's portal must be configured with this exact value.
  return chrome.identity.getRedirectURL();
}

export interface AuthFlowResult {
  code: string;
  state: string;
}

export async function launchAuthFlow(authUrl: string): Promise<AuthFlowResult> {
  log('auth', 'launching web auth flow', authUrl);
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!redirectUrl) {
    logError('auth', 'empty redirectUrl from launchWebAuthFlow');
    throw new Error('Authentication was cancelled or no redirect received.');
  }

  // Bungie redirects to <redirect_uri>?code=...&state=...
  const parsed = new URL(redirectUrl);
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!code || !state) {
    logError('auth', 'redirect missing code/state', redirectUrl);
    throw new Error('Malformed OAuth redirect (missing code or state).');
  }

  return { code, state };
}
