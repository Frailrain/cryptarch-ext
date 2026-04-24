# Distribution status

**Chrome Web Store submission: ON HOLD** — blocked on icon design pass.

## Ready now (post Session 3)

- Functional MV3 extension, installable via Load unpacked for clan testing.
- Plain-English privacy policy at [PRIVACY.md](PRIVACY.md). Publish via GitHub
  Pages (Settings → Pages → deploy from `main` root) when ready to submit.
- Popup + Dashboard + Rules UI + exotic visual polish complete.
- Clan-test checklist pass (see Brief #9 Part E).

## Still blocking store submission

Engineering-wise nothing is blocking — these are assets and a one-time setup:

- **Icons** — 16×16, 48×48, 128×128 PNG, dropped into `public/icons/` and
  referenced via an `icons` block in [src/manifest.ts](src/manifest.ts).
- **Promotional tile** — 440×280 PNG (store listing hero).
- **Screenshots** — 1280×800 PNG, up to five. Typical shots: Dashboard Drop
  Log with matched armor, Rules tab editor, popup with live drops, exotic
  treatment close-up.
- **Store listing copy** — short tagline (≤132 chars), full description,
  category selection ("Productivity" is the usual pick for tool extensions).
- **Chrome Web Store developer account** — $5 one-time registration fee.

Once icons land, the final submission is ~30 minutes of plug-in-and-publish.

## Installation for clan testers (current)

1. Clone the repo or download a zip of `dist/`.
2. `npm install && npm run build` (if from source — otherwise skip).
3. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**,
   select the `dist/` folder.
4. Note the generated extension ID and register
   `https://<extension-id>.chromiumapp.org/` as a redirect URI on Bungie's
   developer portal (or use an existing one).
5. Click the Cryptarch icon → Sign in with Bungie.net from the popup or
   Dashboard. First-boot manifest download takes ~5–30 seconds.
