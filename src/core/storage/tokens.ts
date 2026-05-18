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

// Most-recently-played character snapshot, refreshed each poll. Used by the
// popup's Guardian strip and the dashboard's top-bar emblem chip. classType
// is the Bungie enum (0 = Titan, 1 = Hunter, 2 = Warlock); we keep it raw
// so the UI can render the human label and pick class accents.
export interface ActiveCharacter {
  characterId: string;
  classType: number;
  emblemPath: string;
  emblemBackgroundPath: string | null;
  dateLastPlayed: string;
}

const TOKENS_KEY = 'auth.tokens';
const MEMBERSHIP_KEY = 'auth.primaryMembership';
const BUNGIE_USER_KEY = 'auth.bungieUser';
const AUTH_STATE_KEY = 'auth.state';
const ACTIVE_CHARACTER_KEY = 'auth.activeCharacter';

// 'expired' is distinct from 'signed-out': the user explicitly signed in but
// the session lapsed (typically a ~1hr access-token expiry on a public client
// with no refresh token). The options page renders a re-auth banner only on
// 'expired', not on 'signed-out'.
export type AuthState = 'signed-in' | 'expired' | 'signed-out';

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

export function loadAuthState(): AuthState {
  return getItem<AuthState>(AUTH_STATE_KEY) ?? 'signed-out';
}

export function saveAuthState(state: AuthState): void {
  setItem(AUTH_STATE_KEY, state);
}

export function loadActiveCharacter(): ActiveCharacter | null {
  return getItem<ActiveCharacter>(ACTIVE_CHARACTER_KEY);
}

export function saveActiveCharacter(c: ActiveCharacter): void {
  setItem(ACTIVE_CHARACTER_KEY, c);
}

export function clearActiveCharacter(): void {
  removeItem(ACTIVE_CHARACTER_KEY);
}
