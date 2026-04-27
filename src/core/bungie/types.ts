export interface BungieServerResponse<T> {
  Response: T;
  ErrorCode: number;
  ErrorStatus: string;
  Message: string;
  MessageData?: Record<string, unknown>;
  ThrottleSeconds?: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  membership_id: string;
  // Only returned for confidential OAuth clients (those with a client secret).
  // Public clients receive an access token only.
  refresh_token?: string;
  refresh_expires_in?: number;
}

export interface BungieNetUser {
  membershipId: string;
  uniqueName: string;
  displayName: string;
  bungieGlobalDisplayName?: string;
  bungieGlobalDisplayNameCode?: number;
  profilePicturePath?: string;
}

export interface DestinyMembershipRaw {
  membershipType: number;
  membershipId: string;
  displayName: string;
  iconPath?: string;
  crossSaveOverride: number;
  applicableMembershipTypes?: number[];
}

export interface UserMembershipData {
  destinyMemberships: DestinyMembershipRaw[];
  primaryMembershipId?: string;
  bungieNetUser?: BungieNetUser;
}

export interface DestinyCharacter {
  characterId: string;
  dateLastPlayed: string;
  classType: number;
  classHash: number;
  emblemPath: string;
  light: number;
}

export interface DestinyItemComponent {
  itemHash: number;
  itemInstanceId?: string;
  quantity: number;
  bindStatus: number;
  location: number;
  bucketHash: number;
  transferStatus: number;
  lockable: boolean;
  state: number;
}

export interface DestinyItemInstance {
  damageType?: number;
  damageTypeHash?: number;
  primaryStat?: { statHash: number; value: number };
  itemLevel?: number;
  quality?: number;
  isEquipped?: boolean;
  canEquip?: boolean;
  equipRequiredLevel?: number;
  cannotEquipReason?: number;
}

export interface DestinyItemSocket {
  plugHash?: number;
  isEnabled: boolean;
  isVisible: boolean;
  reusablePlugs?: Array<{ plugItemHash: number; canInsert: boolean; enabled: boolean }>;
}

export interface DestinyItemSocketsComponent {
  sockets: DestinyItemSocket[];
}

export interface DestinyItemStatsComponent {
  stats: Record<string, { statHash: number; value: number }>;
}

export interface DestinyCharacterActivities {
  currentActivityHash: number;
  currentActivityModeHash?: number;
  dateActivityStarted?: string;
}

export interface DestinyProfileResponse {
  profile?: { data?: { userInfo: DestinyMembershipRaw; characterIds: string[] } };
  profileInventory?: { data?: { items: DestinyItemComponent[] } };
  characters?: { data?: Record<string, DestinyCharacter> };
  characterInventories?: { data?: Record<string, { items: DestinyItemComponent[] }> };
  characterActivities?: { data?: Record<string, DestinyCharacterActivities> };
  characterEquipment?: { data?: Record<string, { items: DestinyItemComponent[] }> };
  itemComponents?: {
    instances?: { data?: Record<string, DestinyItemInstance> };
    sockets?: { data?: Record<string, DestinyItemSocketsComponent> };
    stats?: { data?: Record<string, DestinyItemStatsComponent> };
    // ProfileComponent.ItemReusablePlugs (310). Per-item map keyed by
    // socket index → array of plug items the user has unlocked for that
    // socket. Populated for crafted weapons (every shaped alternative)
    // and exotic selectable-perk slots. Empty for plain random-roll
    // sockets where the equipped plug is the only option on the instance.
    reusablePlugs?: {
      data?: Record<
        string,
        { plugs: Record<string, Array<{ plugItemHash: number; canInsert?: boolean; enabled?: boolean }>> }
      >;
    };
  };
}

export interface DestinyManifestInfo {
  version: string;
  mobileAssetContentPath: string;
  mobileGearAssetDataBases: unknown[];
  mobileWorldContentPaths: Record<string, string>;
  jsonWorldContentPaths: Record<string, string>;
  jsonWorldComponentContentPaths: Record<string, Record<string, string>>;
}

export interface DisplayProperties {
  name: string;
  description: string;
  icon?: string;
  hasIcon: boolean;
}

export interface DestinyInventoryItem {
  hash: number;
  displayProperties: DisplayProperties;
  itemType: number;
  itemSubType: number;
  itemTypeDisplayName?: string;
  itemTypeAndTierDisplayName?: string;
  inventory?: {
    tierType: number;
    tierTypeName: string;
    bucketTypeHash: number;
  };
  defaultDamageType?: number;
  collectibleHash?: number;
  sockets?: {
    socketEntries?: Array<{
      socketTypeHash: number;
      singleInitialItemHash?: number;
      reusablePlugItems?: Array<{ plugItemHash: number }>;
      // Brief #14 Part C: random-roll perk pool. Set on legendary weapon
      // perk sockets (barrel/mag/perk1/perk2 and sometimes origin trait);
      // resolved via DestinyPlugSetDefinition[hash] → reusablePlugItems[].
      randomizedPlugSetHash?: number;
      reusablePlugSetHash?: number;
    }>;
  };
  plug?: {
    plugCategoryIdentifier?: string;
    plugCategoryHash?: number;
  };
}

export interface DestinyStat {
  hash: number;
  displayProperties: DisplayProperties;
}

// Brief #14 Part C: a "plug set" enumerates the plugs (perks, mods, etc.)
// available to a socket. For random-roll weapons the matcher resolves
// socketEntries[i].randomizedPlugSetHash → DestinyPlugSet to enumerate the
// pool of perks that could have rolled in column i. currentlyCanRoll flags
// perks that are deprecated in the live sandbox (kept in the manifest for
// historical drops); the perk-pool cache filters to currentlyCanRoll = true
// so the dashboard doesn't display perks the user can't actually get.
export interface DestinyPlugSet {
  hash: number;
  reusablePlugItems: Array<{
    plugItemHash: number;
    currentlyCanRoll: boolean;
  }>;
}

export interface SetLockStateBody {
  state: boolean;
  itemId: string;
  characterId: string;
  membershipType: number;
}

export class BungieApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode: number,
    public readonly errorStatus: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BungieApiError';
  }
}

export class BungieAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BungieAuthError';
  }
}

export class BungieNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'BungieNetworkError';
  }
}
