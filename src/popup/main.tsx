import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLoadedSubset } from '@/adapters/storage';
import { Popup } from './Popup';
import './popup.css';

// Only the keys the popup actually reads. Skipping the wishlists key
// (60 MB+ of parsed entries) shaves 5-10 s off cold popup boot — the
// previous ensureLoaded() called chrome.storage.local.get(null) which
// pulled the whole payload across the IPC and JSON-deserialized it
// before the popup could render. The popup never touches wishlist data.
const POPUP_STORAGE_KEYS = [
  'drop-feed',
  'auth.tokens',
  'auth.primaryMembership',
  'auth.state',
  'popupFilterState',
  'scoring-config',
  'pendingNavigation',
];

async function bootstrap() {
  await ensureLoadedSubset(POPUP_STORAGE_KEYS);
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');
  createRoot(container).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
}

void bootstrap();
