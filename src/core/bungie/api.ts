import { getValidAccessToken } from './auth';
import { logJson, error as logError } from '@/adapters/logger';
import {
  BUNGIE_ORIGIN,
  BUNGIE_PLATFORM,
  MANIFEST_PATH,
  SET_LOCK_STATE_PATH,
  USER_GET_MEMBERSHIPS,
  profilePath,
  type ProfileComponent,
} from './endpoints';
import { bungieRateLimiter } from './rate-limiter';
import {
  BungieApiError,
  BungieAuthError,
  BungieNetworkError,
  type BungieServerResponse,
  type DestinyManifestInfo,
  type DestinyProfileResponse,
  type SetLockStateBody,
  type UserMembershipData,
} from './types';

const API_KEY: string = import.meta.env.VITE_BUNGIE_API_KEY ?? '';

interface BungieRequestOptions {
  body?: unknown;
  authenticated?: boolean;
}

const MAX_5XX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bungieRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  options: BungieRequestOptions = {},
): Promise<T> {
  const authenticated = options.authenticated !== false;

  const headers: Record<string, string> = {
    'X-API-Key': API_KEY,
  };

  if (authenticated) {
    const token = await getValidAccessToken();
    if (!token) throw new BungieAuthError('No valid access token');
    headers['Authorization'] = `Bearer ${token}`;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const url = path.startsWith('http') ? path : `${BUNGIE_PLATFORM}${path}`;

  const loggedHeaders: Record<string, string> = { ...headers };
  if (loggedHeaders['Authorization']) loggedHeaders['Authorization'] = '[REDACTED]';
  if (loggedHeaders['X-API-Key']) loggedHeaders['X-API-Key'] = '[REDACTED]';

  let attempt = 0;
  while (true) {
    await bungieRateLimiter.acquire();
    logJson('bungieRequest', 'outgoing', {
      method,
      url,
      explicitHeaders: loggedHeaders,
      ctx: typeof self === 'object' && 'ServiceWorkerGlobalScope' in self ? 'sw' : 'page',
    });
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (err) {
      throw new BungieNetworkError('Network error calling Bungie', err);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
      await sleep(Math.max(1, retryAfter) * 1000);
      continue;
    }

    if (response.status >= 500 && response.status < 600 && attempt < MAX_5XX_RETRIES) {
      await sleep(1000 * Math.pow(2, attempt));
      attempt += 1;
      continue;
    }

    let parsed: BungieServerResponse<T>;
    try {
      parsed = (await response.json()) as BungieServerResponse<T>;
    } catch (err) {
      throw new BungieNetworkError(`Invalid JSON from Bungie (HTTP ${response.status})`, err);
    }

    if (parsed.ErrorCode !== 1) {
      logError('bungieRequest', 'error response', {
        url,
        httpStatus: response.status,
        body: parsed,
      });
      throw new BungieApiError(
        parsed.Message || 'Bungie API error',
        parsed.ErrorCode,
        parsed.ErrorStatus,
        response.status,
      );
    }

    return parsed.Response;
  }
}

export async function getMembershipsForCurrentUser(): Promise<UserMembershipData> {
  return bungieRequest<UserMembershipData>('GET', USER_GET_MEMBERSHIPS);
}

export async function getProfile(
  membershipType: number,
  membershipId: string,
  components: ProfileComponent[],
): Promise<DestinyProfileResponse> {
  const qs = `?components=${components.join(',')}`;
  return bungieRequest<DestinyProfileResponse>(
    'GET',
    `${profilePath(membershipType, membershipId)}${qs}`,
  );
}

export async function getManifestInfo(): Promise<DestinyManifestInfo> {
  return bungieRequest<DestinyManifestInfo>('GET', MANIFEST_PATH, { authenticated: false });
}

export type SetLockStateOutcome = 'changed' | 'no-op';

export async function setLockState(
  membershipType: number,
  characterId: string,
  itemId: string,
  locked: boolean,
): Promise<SetLockStateOutcome> {
  const body: SetLockStateBody = { state: locked, itemId, characterId, membershipType };
  const result = await bungieRequest<number>('POST', SET_LOCK_STATE_PATH, { body });
  return result === 1 ? 'changed' : 'no-op';
}

export async function fetchManifestComponent<T>(relativePath: string): Promise<T> {
  const url = `${BUNGIE_ORIGIN}${relativePath}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new BungieNetworkError(`Failed to fetch manifest component: ${relativePath}`, err);
  }
  if (!response.ok) {
    throw new BungieNetworkError(
      `Manifest component HTTP ${response.status}: ${relativePath}`,
    );
  }
  return (await response.json()) as T;
}
