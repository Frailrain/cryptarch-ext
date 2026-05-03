import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLoadedSubset } from '@/adapters/storage';
import { Settings } from './Settings';
import './settings.css';

// Every key the dashboard's initial render reads. Deliberately excludes the
// `wishlists` key (~60 MB+ of parsed entries) — only the SW's matcher needs
// the full payload. Brief #12.5 Part D added the lightweight wishlistMetadata
// view (name + entryCount + importedAt per source); the Weapons-tab
// WishlistsPanel reads that for display, eliminating the multi-second freeze
// that previously hit the dashboard on first Weapons-tab open.
const DASHBOARD_STORAGE_KEYS = [
  'drop-feed',
  'auth.tokens',
  'auth.primaryMembership',
  'auth.state',
  'manifest.ready',
  'manifest.progress',
  'autolock.failed.last',
  'scoring-config',
  // Brief #23: master auto-lock toggle (default off). Read on initial paint
  // so the toggle reflects the persisted value without a flash of the wrong
  // state, and so saves from one tab propagate to all open dashboards.
  'settings.autoLock',
  'pendingNavigation',
  'armor-rules',
  'wishlistSources',
  'wishlistMetadata',
  // Brief #19: WeaponsPanel reads both for the Charles selector + Voltron
  // confirmation toggle, plus the legacy weaponFilterConfig key for the
  // migration adapter that derives initial Charles config from old tierFilter.
  'weaponFilterConfig',
  'charlesSourceConfig',
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
