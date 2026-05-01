// Brief #22: network-only client for the cryptarch-auth Worker. Replaces the
// extension's direct calls to bungie.net's OAuth token endpoint — the Worker
// holds the confidential client_secret and brokers exchange/refresh on our
// behalf. The extension never sees the client_secret.

import type { OAuthTokenResponse } from '@/core/bungie/types';

const WORKER_URL = (import.meta.env.VITE_AUTH_WORKER_URL ?? '').replace(/\/+$/, '');

export class AuthRefreshExpiredError extends Error {
  constructor(message = 'Refresh token rejected by Bungie') {
    super(message);
    this.name = 'AuthRefreshExpiredError';
  }
}

export class AuthUpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthUpstreamError';
  }
}

export class AuthConfigError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

interface ExchangeArgs {
  code: string;
  clientId: string;
  redirectUri: string;
}

interface RefreshArgs {
  refreshToken: string;
  clientId: string;
}

type TokenPath = '/token/exchange' | '/token/refresh';

async function callWorker(
  path: TokenPath,
  body: Record<string, string>,
): Promise<OAuthTokenResponse> {
  if (!WORKER_URL) {
    throw new AuthConfigError('VITE_AUTH_WORKER_URL is not configured', 0);
  }

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AuthUpstreamError('Network error calling auth worker', undefined, err);
  }

  // Body is the Bungie response forwarded 1:1 on success, or { error } on
  // worker rejections (origin_mismatch, unknown_client, malformed_json,
  // missing_fields, rate_limited).
  const bodyText = await response.text();
  let parsed: unknown;
  try {
    parsed = bodyText.length > 0 ? JSON.parse(bodyText) : {};
  } catch {
    throw new AuthUpstreamError(
      `Auth worker returned non-JSON body (HTTP ${response.status})`,
      response.status,
    );
  }

  if (response.ok) {
    const token = parsed as Partial<OAuthTokenResponse>;
    if (typeof token.access_token !== 'string') {
      throw new AuthUpstreamError('Auth worker response missing access_token', response.status);
    }
    return token as OAuthTokenResponse;
  }

  // Refresh path + 401 = the refresh_token is dead. The only error type the
  // caller (tokenManager / auth.ts) special-cases — flips us to 'expired'.
  if (path === '/token/refresh' && response.status === 401) {
    throw new AuthRefreshExpiredError();
  }

  // 5xx (Bungie or worker), 429 (rate-limited): transient, caller may retry.
  if (response.status >= 500 || response.status === 429) {
    throw new AuthUpstreamError(
      `Auth worker upstream error (HTTP ${response.status})`,
      response.status,
    );
  }

  // 4xx (worker config rejection or Bungie rejecting the code/secret).
  // These are configuration bugs from the extension's perspective.
  throw new AuthConfigError(
    `Auth worker rejected request (HTTP ${response.status})`,
    response.status,
    parsed,
  );
}

export async function exchangeCode(args: ExchangeArgs): Promise<OAuthTokenResponse> {
  return callWorker('/token/exchange', {
    code: args.code,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
  });
}

export async function refreshTokens(args: RefreshArgs): Promise<OAuthTokenResponse> {
  return callWorker('/token/refresh', {
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
}
