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
  // Brief #12 Part G/H: included so onChanged updates to the Weapons-tab
  // config are visible in the popup context, even though the popup itself
  // doesn't currently render anything from it. Forward-compat for a future
  // "show only what'd notify me" filter or similar.
  'weaponFilterConfig',
];

// Brief #12.5 Part D — popup boot timing instrumentation. Matt reported every
// extension reload triggers ~10 s lag on the next popup open. We don't have a
// confirmed root cause yet (suspected: chrome.storage.local cold-init in popup
// context, or React 18 first-render cost). These markers print to the popup
// devtools console (right-click popup → Inspect → Console) so we can pinpoint
// which phase is actually slow before optimizing. Cheap to leave in; remove
// once we have the data and a fix lands.
const T_MODULE_LOAD = performance.now();

async function bootstrap() {
  const tBootstrapStart = performance.now();
  console.log(
    `[popup-perf] module-load → bootstrap-start: ${(tBootstrapStart - T_MODULE_LOAD).toFixed(1)}ms`,
  );

  const tBeforeStorage = performance.now();
  await ensureLoadedSubset(POPUP_STORAGE_KEYS);
  const tAfterStorage = performance.now();
  console.log(
    `[popup-perf] ensureLoadedSubset(${POPUP_STORAGE_KEYS.length} keys): ${(tAfterStorage - tBeforeStorage).toFixed(1)}ms`,
  );

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');

  const tBeforeRender = performance.now();
  createRoot(container).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
  const tAfterRender = performance.now();
  console.log(
    `[popup-perf] createRoot.render: ${(tAfterRender - tBeforeRender).toFixed(1)}ms`,
  );
  console.log(
    `[popup-perf] total (module-load → first-render): ${(tAfterRender - T_MODULE_LOAD).toFixed(1)}ms`,
  );
}

void bootstrap();
