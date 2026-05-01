import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

// Pinning the public half of an RSA-2048 keypair makes the unpacked
// extension ID deterministic across rebuilds and machines. Without this,
// Chrome derives an ID from the unpacked path, which churns and forces a
// Bungie portal + worker origin-allowlist re-update because OAuth keys
// off the ID.
//
// IMPORTANT: only emitted in development builds. Web Store uploads MUST
// omit `key` for items that already have a Store-registered key (Cryptarch
// does — it was registered when v0.5.0 first shipped). With `key` absent,
// the Store uses its registered key and the published item gets the
// Store-signed ID (nmalcfpnieandofopopffppijcadibkg). Dev unpacked builds
// keep the pinned local ID (nllmfpgnfndapapboelfefhdoneljhhk).
const DEV_PINNED_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq1Hnc6tFg4paU+T3q0629dkzpxLNub3V7QU0k4uLRTf9IVLDpF/aWbHvZ0Q5xeAIDx9f1AvB1atriQYQezjrz9zbjm0CLDQz9mosoRK4PLDWsle36y8r0RGQVb3JiHgzP70+KBQ67vN54RSpw+LRPKPf16owYq5vl3MBJGPT03hggdoE4+dJ27W3ujNFGpjEA3Te2iIOQ/TA9x5gGEBoklcxep+eUdNLMwniVhmpF9tkbVp2JXuEhK+y7ZnIGA0iEKwsArdegMpY6lUWg2eMfmInzLS1ZC7VFLKxgJ/sOm2zfgqyAszyZzS498UeM6SpDNfir1iZyKhodl+r/B1QXQIDAQAB';

export default defineManifest((env) => ({
  manifest_version: 3,
  name: 'Cryptarch - Destiny 2 Loot Appraiser',
  version: pkg.version,
  description:
    'Real-time god roll alerts for Destiny 2. Auto-locks keepers before you dismantle them.',
  ...(env.mode === 'development' ? { key: DEV_PINNED_KEY } : {}),
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: 'Cryptarch',
    default_popup: 'src/popup/popup.html',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
    },
  },
  options_page: 'src/settings/settings.html',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  // unlimitedStorage is required because parsed wishlists are huge — Voltron
  // alone is ~30 MB JSON-serialized (247k entries), well past chrome.storage.local's
  // default 10 MB quota. Without this permission, every saveWishlists call
  // silently rejects with QUOTA_BYTES, leaving the SW's hydrate step reading
  // an empty wishlists key on next wake even though the in-memory adapter cache
  // (in the writing context) showed the data.
  permissions: ['storage', 'unlimitedStorage', 'alarms', 'notifications', 'identity'],
  host_permissions: [
    'https://www.bungie.net/*',
    'https://raw.githubusercontent.com/*',
    'https://cryptarch-auth.cryptarch.workers.dev/*',
  ],
}));
