import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Cryptarch — Loot Appraiser',
  version: pkg.version,
  description:
    'Real-time god roll alerts for Destiny 2. Auto-locks keepers before you dismantle them.',
  action: {
    default_title: 'Cryptarch',
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
  // Icons intentionally omitted — Matt's design pass is a parallel track.
  // Drop 16/48/128 PNGs into public/icons/ and re-add the `icons` block
  // before Chrome Web Store submission. Without them Chrome shows a generic
  // puzzle-piece icon; functionality is unaffected.
});
