import { getItem, removeItem, setItem } from '@/adapters/storage';

export interface StoredTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  bungieMembershipId: string;
  // Public OAuth clients on Bungie (no client secret) do NOT receive refresh
  // tokens — these fields are only present for confidential clients. When
  // missing, the session ends when the access token expires (~1 hour).
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
}

export interface DestinyMembership {
  membershipType: number;
  membershipId: string;
  displayName: string;
  iconPath: string | null;
  crossSaveOverride: number;
}

const TOKENS_KEY = 'auth.tokens';
const MEMBERSHIP_KEY = 'auth.primaryMembership';
const BUNGIE_USER_KEY = 'auth.bungieUser';

export interface CachedBungieUser {
  bungieGlobalDisplayName: string | null;
  bungieGlobalDisplayNameCode: number | null;
  uniqueName: string | null;
}

export function loadTokens(): StoredTokens | null {
  return getItem<StoredTokens>(TOKENS_KEY);
}

export function saveTokens(tokens: StoredTokens): void {
  setItem(TOKENS_KEY, tokens);
}

export function clearTokens(): void {
  removeItem(TOKENS_KEY);
}

export function loadPrimaryMembership(): DestinyMembership | null {
  return getItem<DestinyMembership>(MEMBERSHIP_KEY);
}

export function savePrimaryMembership(m: DestinyMembership): void {
  setItem(MEMBERSHIP_KEY, m);
}

export function clearPrimaryMembership(): void {
  removeItem(MEMBERSHIP_KEY);
}

export function loadBungieUser(): CachedBungieUser | null {
  return getItem<CachedBungieUser>(BUNGIE_USER_KEY);
}

export function saveBungieUser(u: CachedBungieUser): void {
  setItem(BUNGIE_USER_KEY, u);
}

export function clearBungieUser(): void {
  removeItem(BUNGIE_USER_KEY);
}
