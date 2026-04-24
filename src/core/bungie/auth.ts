import {
  clearBungieUser,
  clearPrimaryMembership,
  clearTokens,
  type DestinyMembership,
  loadPrimaryMembership,
  loadTokens,
  saveTokens,
  type StoredTokens,
} from '@/core/storage/tokens';
import { getRedirectUri, launchAuthFlow } from '@/adapters/oauth';
import { logJson, error as logError } from '@/adapters/logger';
import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL } from './endpoints';
import { BungieAuthError, BungieNetworkError, type OAuthTokenResponse } from './types';

const CLIENT_ID: string = import.meta.env.VITE_BUNGIE_CLIENT_ID ?? '';
const CLIENT_SECRET: string = import.meta.env.VITE_BUNGIE_CLIENT_SECRET ?? '';
const API_KEY: string = import.meta.env.VITE_BUNGIE_API_KEY ?? '';

const ACCESS_REFRESH_BUFFER_MS = 60_000;

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
  const tokens = loadTokens();
  if (!tokens) return false;
  // Confidential clients have a refresh token whose expiry bounds the session
  // (~90 days). Public clients only have an access token (~1 hour) and the
  // user has to re-sign-in when it expires.
  const sessionExpiresAt = tokens.refreshTokenExpiresAt ?? tokens.accessTokenExpiresAt;
  return sessionExpiresAt > Date.now();
}

function basicAuthHeader(): string | null {
  if (!CLIENT_SECRET) return null;
  const creds = `${CLIENT_ID}:${CLIENT_SECRET}`;
  return `Basic ${btoa(creds)}`;
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

async function requestToken(formBody: string): Promise<OAuthTokenResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-API-Key': API_KEY,
  };
  const basic = basicAuthHeader();
  if (basic) headers['Authorization'] = basic;

  const loggedHeaders: Record<string, string> = { ...headers };
  if (loggedHeaders['Authorization']) loggedHeaders['Authorization'] = '[REDACTED]';
  loggedHeaders['X-API-Key'] = '[REDACTED]';

  logJson('requestToken', 'outgoing', {
    method: 'POST',
    url: OAUTH_TOKEN_URL,
    explicitHeaders: loggedHeaders,
    mode: basic ? 'confidential' : 'public',
  });

  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers,
      body: formBody,
    });
  } catch (err) {
    throw new BungieNetworkError('Network error during token exchange', err);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    logError('requestToken', 'error response', {
      url: OAUTH_TOKEN_URL,
      httpStatus: response.status,
      body: json,
    });
    const desc =
      (json['error_description'] as string | undefined) ??
      (json['error'] as string | undefined) ??
      'unknown';
    throw new BungieAuthError(`Token endpoint HTTP ${response.status}: ${desc}`);
  }

  const tokenResponse = json as unknown as OAuthTokenResponse;
  if (typeof tokenResponse.access_token !== 'string') {
    throw new BungieAuthError('Malformed token response');
  }

  return tokenResponse;
}

// Launch the Bungie OAuth authorize page via chrome.identity.launchWebAuthFlow
// and exchange the returned code for tokens. Unlike the Overwolf flow, there is
// no persisted "pending state" — chrome.identity blocks until the redirect
// completes, so state validation happens in one pass.
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

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: result.code,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
  }).toString();

  const tokenResp = await requestToken(form);
  const tokens = tokensFromResponse(tokenResp);
  saveTokens(tokens);
  return tokens;
}

export async function refreshTokens(): Promise<StoredTokens | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const current = loadTokens();
    if (!current) return null;
    // Public clients have no refresh token — there's nothing to refresh, and
    // the caller will get null and have to prompt the user to re-sign-in.
    if (!current.refreshToken || current.refreshTokenExpiresAt === undefined) {
      return null;
    }
    if (current.refreshTokenExpiresAt <= Date.now()) {
      await logout();
      return null;
    }
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: CLIENT_ID,
    }).toString();

    try {
      const resp = await requestToken(form);
      const tokens = tokensFromResponse(resp);
      saveTokens(tokens);
      return tokens;
    } catch (err) {
      if (err instanceof BungieAuthError) {
        await logout();
        return null;
      }
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
