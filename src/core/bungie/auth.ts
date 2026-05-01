import {
  clearBungieUser,
  clearPrimaryMembership,
  clearTokens,
  type DestinyMembership,
  loadAuthState,
  loadPrimaryMembership,
  loadTokens,
  saveAuthState,
  saveTokens,
  type StoredTokens,
} from '@/core/storage/tokens';
import { getRedirectUri, launchAuthFlow } from '@/adapters/oauth';
import { log, logJson, error as logError } from '@/adapters/logger';
import { OAUTH_AUTHORIZE_URL } from './endpoints';
import { BungieAuthError, type OAuthTokenResponse } from './types';
import {
  AuthRefreshExpiredError,
  exchangeCode,
  refreshTokens as workerRefreshTokens,
} from '@/auth/cryptarchAuthClient';

const CLIENT_ID: string = import.meta.env.VITE_BUNGIE_CLIENT_ID ?? '';

// Refresh-ahead window: refresh whenever the access token has less than this
// long before expiry. Brief #22 calls for 10 min on a 1hr token.
const ACCESS_REFRESH_BUFFER_MS = 10 * 60 * 1000;

export interface AuthState {
  tokens: StoredTokens | null;
  primaryMembership: DestinyMembership | null;
}

let refreshInFlight: Promise<StoredTokens | null> | null = null;

export function getAuthState(): AuthState {
  return {
    tokens: loadTokens(),
    primaryMembership: loadPrimaryMembership(),
  };
}

export function isLoggedIn(): boolean {
  // Brief #22: an explicit 'expired' state (set when refresh fails or a
  // Bungie call returns 401) overrides time-based logic. The user keeps
  // their stored tokens until they reconnect — that's how the popup/dashboard
  // know to render the reconnect banner instead of "Sign in."
  if (loadAuthState() === 'expired') return false;
  const tokens = loadTokens();
  if (!tokens) return false;
  // Confidential clients have a refresh token whose expiry bounds the session
  // (~90 days). Public clients only have an access token (~1 hour) and the
  // user has to re-sign-in when it expires. Post-#22 every new session is
  // confidential, but legacy stored tokens may still lack refresh metadata
  // until the upgrade migration kicks in.
  const sessionExpiresAt = tokens.refreshTokenExpiresAt ?? tokens.accessTokenExpiresAt;
  return sessionExpiresAt > Date.now();
}

export function isAuthDisconnected(): boolean {
  return loadAuthState() === 'expired';
}

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tokensFromResponse(resp: OAuthTokenResponse): StoredTokens {
  const now = Date.now();
  const tokens: StoredTokens = {
    accessToken: resp.access_token,
    accessTokenExpiresAt: now + resp.expires_in * 1000,
    bungieMembershipId: resp.membership_id,
  };
  if (resp.refresh_token && typeof resp.refresh_expires_in === 'number') {
    tokens.refreshToken = resp.refresh_token;
    tokens.refreshTokenExpiresAt = now + resp.refresh_expires_in * 1000;
  }
  return tokens;
}

// Launch the Bungie OAuth authorize page via chrome.identity.launchWebAuthFlow
// and exchange the returned code for tokens via the cryptarch-auth Worker.
// chrome.identity blocks until the redirect completes, so state validation
// happens in one pass.
export async function startLoginFlow(): Promise<StoredTokens> {
  const state = randomState();
  const redirectUri = getRedirectUri();
  const authUrl =
    `${OAUTH_AUTHORIZE_URL}?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  const result = await launchAuthFlow(authUrl);
  if (result.state !== state) {
    throw new BungieAuthError('OAuth state mismatch');
  }

  logJson('auth', 'exchanging code via worker', { clientId: CLIENT_ID });
  const tokenResp = await exchangeCode({
    code: result.code,
    clientId: CLIENT_ID,
    redirectUri,
  });
  const tokens = tokensFromResponse(tokenResp);
  saveTokens(tokens);
  // A successful exchange clears any prior 'expired' state — fresh session.
  saveAuthState('signed-in');
  return tokens;
}

export async function refreshTokens(): Promise<StoredTokens | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const current = loadTokens();
    if (!current) return null;
    if (!current.refreshToken || current.refreshTokenExpiresAt === undefined) {
      // Pre-#22 public-client tokens lack a refresh token. The upgrade
      // migration flips state to 'expired' in onInstalled; defensively do
      // the same here in case migration was missed.
      saveAuthState('expired');
      return null;
    }
    if (current.refreshTokenExpiresAt <= Date.now()) {
      saveAuthState('expired');
      return null;
    }

    try {
      const resp = await workerRefreshTokens({
        refreshToken: current.refreshToken,
        clientId: CLIENT_ID,
      });
      const tokens = tokensFromResponse(resp);
      saveTokens(tokens);
      log('auth', `refresh-ahead fired, new expiresAt=${tokens.accessTokenExpiresAt}`);
      // If we'd previously flipped to 'expired' (e.g. a 401 from a Bungie
      // API call surfaced before the next refresh-ahead window), a successful
      // refresh restores 'signed-in'.
      if (loadAuthState() !== 'signed-in') saveAuthState('signed-in');
      return tokens;
    } catch (err) {
      if (err instanceof AuthRefreshExpiredError) {
        // Brief #22: refresh_token rejected by Bungie. Don't clear tokens —
        // the UI watches auth.state to decide between "signed in," "expired"
        // (show reconnect banner), and "signed out." Tokens stay on disk
        // until the user reconnects (overwrites them) or signs out (clears).
        saveAuthState('expired');
        return null;
      }
      // AuthUpstreamError / AuthConfigError / unexpected: bubble up so the
      // caller's logging captures it. Don't flip state for transient errors.
      logError('auth', 'refresh failed', err instanceof Error ? err.message : err);
      throw err;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const current = loadTokens();
  if (!current) return null;
  if (loadAuthState() === 'expired') return null;
  if (current.accessTokenExpiresAt - Date.now() > ACCESS_REFRESH_BUFFER_MS) {
    return current.accessToken;
  }
  const refreshed = await refreshTokens();
  return refreshed?.accessToken ?? null;
}

export async function logout(): Promise<void> {
  clearTokens();
  clearPrimaryMembership();
  clearBungieUser();
}

// Brief #22: on extension upgrade, detect tokens that were minted under the
// old public-client flow (no refresh_token field) and flip to 'expired' so
// the reconnect banner shows on next popup open. Wired from the SW's
// onInstalled handler with reason='update'.
export function migrateAuthOnUpgrade(): void {
  const tokens = loadTokens();
  if (!tokens) return;
  const isLegacyPublicClient =
    !tokens.refreshToken || tokens.refreshTokenExpiresAt === undefined;
  if (isLegacyPublicClient) {
    saveAuthState('expired');
    logJson('auth', 'legacy public-client tokens detected; marked expired', {});
  }
}
