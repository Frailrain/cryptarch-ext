import {
  DEFAULT_SCORING_CONFIG,
  type ImportedWishList,
  type ScoringConfig,
} from '@/core/scoring/types';
import { getItem, setItem } from '@/adapters/storage';

const SCORING_CONFIG_KEY = 'scoring-config';
const WISHLISTS_KEY = 'wishlists';

// wishlists and armorRules live in their own storage keys so the scoring-config
// blob stays small. Everything else rides in scoring-config.
type StoredScoringConfig = Omit<ScoringConfig, 'wishlists' | 'armorRules'>;

export function loadScoringConfig(): ScoringConfig {
  const stored = getItem<StoredScoringConfig>(SCORING_CONFIG_KEY);
  if (!stored) return { ...DEFAULT_SCORING_CONFIG };
  return {
    ...DEFAULT_SCORING_CONFIG,
    ...stored,
    customRules: stored.customRules ?? [],
    wishlists: [],
    armorRules: [],
  };
}

export function saveScoringConfig(config: ScoringConfig): void {
  const { wishlists: _wishlists, armorRules: _armorRules, ...rest } = config;
  void _wishlists;
  void _armorRules;
  setItem<StoredScoringConfig>(SCORING_CONFIG_KEY, rest);
}

export function loadWishlists(): ImportedWishList[] {
  return getItem<ImportedWishList[]>(WISHLISTS_KEY) ?? [];
}

export function saveWishlists(lists: ImportedWishList[]): void {
  setItem<ImportedWishList[]>(WISHLISTS_KEY, lists);
}
