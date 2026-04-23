export const BUNGIE_ORIGIN = 'https://www.bungie.net';
export const BUNGIE_PLATFORM = `${BUNGIE_ORIGIN}/Platform`;

export const OAUTH_AUTHORIZE_URL = `${BUNGIE_ORIGIN}/en/OAuth/Authorize`;
export const OAUTH_TOKEN_URL = `${BUNGIE_PLATFORM}/App/OAuth/Token/`;

export const USER_GET_CURRENT = `/User/GetCurrentBungieUser/`;
export const USER_GET_MEMBERSHIPS = `/User/GetMembershipsForCurrentUser/`;

export function profilePath(membershipType: number, membershipId: string): string {
  return `/Destiny2/${membershipType}/Profile/${membershipId}/`;
}

export const MANIFEST_PATH = `/Destiny2/Manifest/`;
export const SET_LOCK_STATE_PATH = `/Destiny2/Actions/Items/SetLockState/`;

export enum ProfileComponent {
  Profiles = 100,
  ProfileInventories = 102,
  Characters = 200,
  CharacterInventories = 201,
  CharacterActivities = 204,
  CharacterEquipment = 205,
  ItemInstances = 300,
  ItemStats = 304,
  ItemSockets = 305,
}
