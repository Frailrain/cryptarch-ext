# Handoff: Cryptarch Extension — Destiny-Native Redesign

## Overview

This is a complete visual redesign of Cryptarch, a Destiny 2 loot appraiser Chrome extension. The redesign transforms the UI from generic React + Tailwind dark mode into something that feels like it belongs inside the Destiny 2 universe — sacred geometry backgrounds, D2-style item-acquired animations, angular controls, legendary purple weapon names, and real weapon/perk iconography.

## About the Design Files

The files in this bundle are **design references created in HTML/React** — interactive prototypes showing intended look, behavior, and animation. They are NOT production code to ship directly. The task is to **recreate these designs in the existing Cryptarch Chrome extension codebase** (`src/popup/`, `src/settings/`) using its React + TypeScript + Tailwind environment.

The existing codebase is at [github.com/Frailrain/cryptarch-ext](https://github.com/Frailrain/cryptarch-ext) (v0.6.2, Chrome MV3, React 18, Tailwind 3, TypeScript).

## Fidelity

**High-fidelity.** These are pixel-level mockups with final colors, typography, spacing, animations, and interactions. The developer should recreate the UI faithfully using the codebase's existing React component structure, replacing Tailwind utility classes with the new token values.

---

## Screens / Views

### 1. Popup (400 × 600)
**File:** `popup-full.html` → `Popup.jsx`

**Purpose:** Quick-glance notification feed hanging off the Chrome toolbar icon. Shows recent god-roll / keeper / exotic drops with lock actions.

**Layout:**
- Fixed 400×600, vertical flex column
- Sacred geometry background layer (absolute positioned, `z-index: 0`, animated drift)
- All content sections at `z-index: 1`

**Sections (top to bottom):**

1. **Header bar** — `padding: 12px 16px`, bottom border hairline
   - Left: Extension icon (20×20, gold hairline border) + "CRYPTARCH" in `uppercase, letter-spacing: 0.22em, font-weight: 300, 13px`
   - Right: Connection indicator (5×5 green square) + username in `uppercase, 9px, letter-spacing: 0.10em, #8c8c8c`

2. **Guardian emblem strip** — full-width, no padding on wrapper
   - Background: gradient placeholder (`linear-gradient(135deg, #2a3040, #1a1e28, #1c2030)` at 60% opacity)
   - Diamond texture overlay at 15% opacity
   - Left: Emblem icon placeholder (32×32, hairline border, Destiny crest SVG at 50% opacity with `filter: invert(1)`)
   - "ACTIVE GUARDIAN" label: `8px, uppercase, rgba(255,255,255,0.5)`
   - Guardian info: "Hunter" in `12px, #e2e2e2, font-weight: 300` + separator + "⚡ 2030" in `10px, rgba(255,255,255,0.6)`
   - Right: "LAST SWEEP" label + time in `11px, #ceae33, font-weight: 500`
   - **Production note:** Replace the gradient background with the player's actual equipped emblem image from `bungie.net`

3. **Drop notification feed** — `flex: 1, overflow-y: auto`
   - Section header: "RECENT DROPS" with trailing hairline
   - Stack of `NotifRow` cards with 4px gap

4. **Auto-lock toggle row** — `padding: 10px 16px`, top border
   - Label: "AUTO-LOCK MATCHES" in `9px uppercase, #9a9da4`
   - Angular two-cell toggle (ON/OFF)

5. **Footer** — `padding: 10px 16px 14px`, top border
   - Bracket button: `▶▶ OPEN DASHBOARD ◀◀` full-width
   - Ko-fi text: `8px, #3e4046, uppercase`

**NotifRow (drop notification card):**
- `padding: 8px 10px`, left border `3px solid {rarityColor}`
- Background gradient: `linear-gradient(90deg, {rarityDim} 0%, transparent 40%)`
- Left: WeaponIcon (38×38) — see Components section
- Center: Item name in rarity color (`#9d71c7` legendary, `#d4af37` exotic), `11px, font-weight: 500, uppercase, letter-spacing: 0.10em`. God rolls get `text-shadow: 0 0 8px rgba(157,113,199,0.3)`
- Sub line: Element pip (6×6 rotated diamond in element color) + subtitle in `9px, #6b6e75, uppercase`
- Right: Perk icons (4× circular, 20px) + GradeBadge + TimeAgo

### 2. Dashboard (full-page)
**File:** `dashboard-full.html` → `Dashboard.jsx`

**Purpose:** Full tab-page app for drop log review, armor rule management, and notification settings.

**Layout:**
- Full viewport width, centered content at `max-width: 1100px, padding: 28px`
- Sacred geometry as `background-image` on the root div, animated

**Sections:**

1. **Top bar** — border-bottom hairline
   - Left: Icon (28×28, gold border) + "CRYPTARCH" (`15px, weight 300, tracking 0.25em`) + "LOOT APPRAISER · V0.6.2" (`8px, #6b6e75`)
   - Right: Connection indicator + username + "SIGN OUT" ghost button

2. **Tab nav** — border-bottom hairline, three tabs
   - Active tab: `color: #ceae33`, `border-bottom: 2px solid #ceae33`, `text-shadow: 0 0 10px rgba(206,174,51,0.5)`
   - Inactive: `color: #6b6e75`, transparent border
   - Style: `10px, font-weight: 500, uppercase, letter-spacing: 0.15em, padding: 12px 22px`

3. **Drops tab** — Drop Log
   - Headline: "DROP LOG" in `18px, weight 300, tracking 0.25em`
   - Filter row: Type chips (All/Weapons/Armor) + Tier chips (S/A/B/C/D/F) + Exotic chip
   - Drop list panel: `background: #1c1e22, border: 1px hairline`, corner tick marks (8px gold dashes at all 4 corners)
   - Each `DropRow`: see Components section

4. **Armor tab** — Armor Rules
   - Headline + auto-lock toggle + `▶▶ + NEW RULE ◀◀` bracket button
   - Rules list in panel with hairline dividers
   - Each rule: Toggle + name/summary + Edit/Delete buttons

5. **Settings tab** — Notification Settings
   - Wishlist Coverage panel (gold top-accent, corner tick marks): Min Tier chips, Perks Per Column chips, Voltron toggle
   - Notifications panel: Radio-style selector with gold left-accent on active
   - Bungie Account panel: username + Disconnect button
   - Gold diamond divider at bottom

### 3. Loot Drop Animation
**File:** `loot-drop-anim.html`

**Purpose:** D2-style "item acquired" animation that plays when new drops arrive from the API. Drops queue and animate one after another, ~1.2s per item.

**Animation sequence (per drop):**
1. **Engram phase (0-400ms):** Rarity-colored diamond shape pulses (`scale 1→1.15→1`, 0.5s loop) at left edge
2. **Decrypt phase (400-700ms):** Diamond spins (`rotate 0→540deg`), scales down to 0, brightness flashes to 3×. 8 particle dots burst outward in a ring
3. **Banner phase (700-1800ms):** Item card slides in from `translateX(-120%)` to `0`. At the 20% mark: full-width flash overlay in rarity color fades from 70%→0% opacity. White light sweep runs left-to-right across the card. Card brightness briefly spikes to 1.6× then settles
4. Card remains visible

**CSS keyframes defined:**
- `dropSlideIn` — translateX(-120%) → 0, with brightness flash at 22%
- `dropFlash` — rarity-colored overlay, opacity 0→0.7→0
- `dropSweep` — white gradient bar, left -50%→120%
- `engram-pulse` — scale 1→1.15→1, opacity 0.6→1→0.6
- `engram-decrypt` — scale 1→1.2→0.3→0, rotate 0→540°, brightness 1→2→3→1
- `particles-burst` — scale 0→2.5, opacity 1→0

---

## Components

### WeaponIcon
- Square (38-48px), sharp corners
- Background: `linear-gradient(145deg, #25282d, #0c0e11)`, darker for exotic: `#302818→#0a0c10`
- Item image rendered as `<img>` with `object-fit: cover` (sourced from Bungie CDN in production; fallback silhouette for mocks)
- Element stripe: 3px bar at bottom in element color (Solar `#f2721b`, Void `#b185db`, Arc `#79c8ec`, Strand `#3ddc84`, Kinetic `#d0cece`) at 90% opacity
- Border: Exotic `rgba(212,175,55,0.6)`, God roll `rgba(157,113,199,0.45)`, Keep `rgba(90,158,111,0.35)`, Default `rgba(255,255,255,0.07)`
- Exotic/god items: `inset box-shadow` for inner glow

### PerkIcon
- **Circular** (18-26px), `border-radius: 50%`
- Ring border: Gold `2px solid #ceae33` for wishlist-tagged, white `1px solid rgba(255,255,255,0.18)` for rolled, dim `rgba(255,255,255,0.06)` for neutral
- Background: `rgba(206,174,51,0.12)` for rolled, `#0c0e11` for neutral
- Inner image: `border-radius: 50%`, 72% of container size, `object-fit: cover`
- Tagged perks: `box-shadow: 0 0 6px rgba(206,174,51,0.3)`
- Dimmed (not rolled, not tagged): `opacity: 0.25`
- **Production:** Use actual perk icon URLs from `bungie.net/common/destiny2_content/icons/`

### GradeBadge
- Angular slash right edge via `clip-path: polygon(0 0, calc(100%-6px) 0, 100% 50%, calc(100%-6px) 100%, 0 100%)`
- Min-width 58px, height 22px, `padding: 0 8px 0 6px` + extra right padding for clip
- Variants:
  - God Roll: `bg: rgba(206,174,51,0.22)`, `color: #f5d96e`, `box-shadow: 0 0 12px rgba(206,174,51,0.3)`
  - Keep: `bg: rgba(90,158,111,0.12)`, `color: #5a9e6f`
  - Exotic: `bg: rgba(212,175,55,0.12)`, `color: #e8c948`, `box-shadow: 0 0 10px rgba(212,175,55,0.25)`
  - Shard: `bg: rgba(194,58,58,0.12)`, `color: #e06060`

### BracketButton (primary CTA)
- `padding: 10px 24px`, gold dim fill `rgba(206,174,51,0.10)`, gold hairline border
- `::before` content `▶▶` and `::after` content `◀◀` at `7px, opacity: 0.7`
- Hover: fill to `rgba(206,174,51,0.18)`, text to `#e8d57a`, border to `#ceae33`
- `uppercase, letter-spacing: 0.15em, font-weight: 500`

### Angular Toggle (ON/OFF)
- `display: inline-grid, grid-template-columns: 34px 34px`, height 22px
- Active cell: gold dim fill, gold text, `text-shadow: 0 0 6px rgba(206,174,51,0.4)`
- Inactive cell: `#25282d` fill, `#9a9da4` text

### Chip (filter toggle)
- `padding: 3px 9px`, `9px, font-weight: 500, uppercase, tracking 0.10em`
- Active: rarity-colored fill + border. Inactive: transparent, hairline border, `#6b6e75` text

### SectionHead
- `11px, uppercase, tracking 0.18em, #6b6e75`
- Trailing flex hairline: `flex: 1, height: 1px, rgba(255,255,255,0.07)`

### Corner tick marks
- 8 spans (horizontal + vertical pair per corner), each `8px × 1px` or `1px × 8px`
- Color: `rgba(206,174,51,0.45)` (gold hairline)
- Position: absolute, pinned to each corner at `-1px` offset

### Sacred Geometry Background
- SVG file at `assets/sacred-geometry.svg` (600×600 tile, 7 layers)
- Applied as `background-image`, `repeat`, animated with `background-position` drift over 120s
- Opacity: 0.6-0.7 in components

### Diamond Divider
- Flex row: hairline — rotated 5×5 square — hairline
- Gold variant: diamond has `border: 1px solid rgba(206,174,51,0.45)`, gold fill for emphatic
- Dim variant: hairline-colored border, no fill

---

## Color Semantics

### Rarity colors (critical — match D2 canon)
| Rarity | Name Color | Border/Accent | Row Tint | Fill (dim) |
|--------|-----------|---------------|----------|------------|
| Legendary (non-exotic weapon) | `#9d71c7` | `rgba(157,113,199,0.45)` | `rgba(82,47,101,0.08)` | `rgba(82,47,101,0.18)` |
| Exotic | `#d4af37` | `rgba(212,175,55,0.6)` | `rgba(212,175,55,0.03)` | `rgba(212,175,55,0.12)` |
| Shard | `#e06060` | `rgba(194,58,58,0.45)` | `rgba(0,0,0,0.15)` (darkened) | `rgba(194,58,58,0.12)` |
| Keep | `#5a9e6f` | `rgba(90,158,111,0.45)` | transparent | `rgba(90,158,111,0.12)` |
| God Roll | `#f5d96e` | `rgba(206,174,51,0.55)` | `rgba(82,47,101,0.08)` | `rgba(206,174,51,0.22)` |

### Shard treatment
Shard-graded items get: row background `rgba(0,0,0,0.15)` + weapon name at `opacity: 0.5`. This creates an at-a-glance "this is trash" signal.

### Element colors
| Element | Hex | Usage |
|---------|-----|-------|
| Solar | `#f2721b` | Element pip, weapon icon bottom stripe |
| Void | `#b185db` | Same |
| Arc | `#79c8ec` | Same |
| Strand | `#3ddc84` | Same |
| Stasis | `#4d88ff` | Same |
| Kinetic | `#d0cece` | Same |

---

## Design Tokens

### Surfaces
| Token | Value | Usage |
|-------|-------|-------|
| `bg-deep` | `#0c0e11` | Popup background, deepest panels |
| `bg-base` | `#151719` | Dashboard background |
| `bg-panel` | `#1c1e22` | Card/panel fill |
| `bg-elevated` | `#25282d` | Hover rows, raised inputs |
| `bg-hover` | `#2a2d33` | Active hover state |

### Borders
| Token | Value |
|-------|-------|
| `hairline` | `rgba(255,255,255,0.07)` |
| `hairline-2` | `rgba(255,255,255,0.035)` |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `text` | `#e2e2e2` | Primary body + headings |
| `text-sec` | `#9a9da4` | Secondary labels |
| `text-muted` | `#6b6e75` | Helper text, timestamps |
| `text-dim` | `#3e4046` | Disabled, deeply de-emphasized |

### Gold accent
| Token | Value |
|-------|-------|
| `gold` | `#ceae33` |
| `gold-pale` | `#e8d57a` |
| `gold-bright` | `#f5d96e` |
| `gold-dim` | `rgba(206,174,51,0.10)` |
| `gold-hover` | `rgba(206,174,51,0.18)` |
| `gold-line` | `rgba(206,174,51,0.45)` |

### Typography
| Property | Value |
|----------|-------|
| Font family | `'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| Header weight | `300` (light) — **never bold** |
| Body weight | `400` |
| Emphasis weight | `500` |
| Header tracking | `0.22em` (headline), `0.15em` (h2), `0.10em` (meta) |
| Header case | ALWAYS UPPERCASE |
| Body case | Sentence case |
| Scale | 9 / 10 / 11 / 12 / 13 / 14 / 18 px |

### Shape
| Property | Value |
|----------|-------|
| Border radius | `0` everywhere, `2px` max |
| Shadows | None. Depth = background stepping only |
| Transitions | `100ms ease` max |

---

## Interactions & Behavior

### Cursor
Custom SVG donut-ring cursor applied via CSS `!important` on `*`:
- Default: white ring (3-stroke layered at different opacities), 26×26, hotspot center
- Pointer (buttons/links): gold ring, 30×30
- **No browser hand cursor** — both states use `auto` fallback

### Hover states
- Buttons: background steps up (dim → hover), text brightens, border strengthens. No color hue shift
- Rows: background to `#2a2d33`
- Text links: shift toward `#e8d57a` (gold-pale)
- Active tabs: `text-shadow: 0 0 10px rgba(206,174,51,0.5)`

### Drop animation queue
When the API polling returns new drops:
1. Push them into a queue array
2. Render each as `<DropNotification index={i}>` where index controls the stagger delay (`index * 1200ms`)
3. Each notification auto-advances through phases: waiting → engram → decrypt → banner → done
4. After the full sequence (~1.8s), the card stays visible as a normal notification row

---

## Assets

| Asset | Path | Source |
|-------|------|--------|
| Extension icon 48px | `assets/icon-48.png` | Original repo |
| Sacred geometry SVG | `assets/sacred-geometry.svg` | Generated — 600×600, 7-layer pattern |
| Weapon type SVGs | `assets/icons/weapons/*.svg` | [justrealmilk/destiny-icons](https://github.com/justrealmilk/destiny-icons) (MIT) |
| General D2 SVGs | `assets/icons/general/*.svg` | Same repo |
| Weapon icon PNGs | `assets/icons/{name}.png` | Generated composites (SVG silhouette on dark bg) |
| Perk icon PNGs | `assets/icons/perk-{name}.png` | Generated composites (SVG in circular D2-style container) |

**In production:** Replace the generated weapon/perk PNGs with real Bungie CDN URLs (`bungie.net/common/destiny2_content/icons/{hash}.jpg`). The mockup icons are placeholders only.

---

## Design Files Reference

| File | What it shows |
|------|---------------|
| `ui_kits/extension/popup-full.html` | Standalone popup at 400×600 |
| `ui_kits/extension/dashboard-full.html` | Standalone dashboard (Drops/Armor/Settings tabs) |
| `ui_kits/extension/loot-drop-anim.html` | Interactive loot-drop animation demo (click "Simulate Drops") |
| `ui_kits/extension/index.html` | Side-by-side popup + dashboard |
| `ui_kits/extension/components.jsx` | All shared React components |
| `ui_kits/extension/Popup.jsx` | Popup component |
| `ui_kits/extension/Dashboard.jsx` | Dashboard component |
| `ui_kits/extension/data.js` | Mock drop data |
| `colors_and_type.css` | Full design token definitions + utility classes |
| `README.md` | Design system documentation |
