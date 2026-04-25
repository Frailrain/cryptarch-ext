import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLoadedSubset } from '@/adapters/storage';
import { Settings } from './Settings';
import './settings.css';

// Every key the dashboard's initial render reads. Deliberately excludes
// `wishlists` (~60 MB+ of parsed entries) — only WishlistsPanel needs that,
// and it lazy-loads via loadAdditionalKeys when the user opens the tab.
// Including it in the boot subset would re-introduce the multi-second
// cold-load lag the popup already eliminated.
const DASHBOARD_STORAGE_KEYS = [
  'drop-feed',
  'auth.tokens',
  'auth.primaryMembership',
  'auth.state',
  'manifest.ready',
  'manifest.progress',
  'autolock.failed.last',
  'scoring-config',
  'pendingNavigation',
  'armor-rules',
  'wishlistSources',
];

async function bootstrap() {
  await ensureLoadedSubset(DASHBOARD_STORAGE_KEYS);
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');
  createRoot(container).render(
    <React.StrictMode>
      <Settings />
    </React.StrictMode>,
  );
}

void bootstrap();
