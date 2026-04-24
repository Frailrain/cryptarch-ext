import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Cryptarch - Destiny 2 Loot Appraiser',
  version: pkg.version,
  description:
    'Real-time god roll alerts for Destiny 2. Auto-locks keepers before you dismantle them.',
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
  permissions: ['storage', 'alarms', 'notifications', 'identity'],
  host_permissions: [
    'https://www.bungie.net/*',
    'https://raw.githubusercontent.com/*',
  ],
});
