/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brief #23 — Destiny-native palette (new code).
        'd-bg-deep':     '#0c0e11',
        'd-bg-base':     '#151719',
        'd-bg-panel':    '#1c1e22',
        'd-bg-elevated': '#25282d',
        'd-bg-hover':    '#2a2d33',
        'd-bg-pressed':  '#15181c',
        'd-hairline':    'rgba(255,255,255,0.07)',
        'd-hairline-2':  'rgba(255,255,255,0.035)',
        'd-text':        '#e2e2e2',
        'd-text-sec':    '#9a9da4',
        'd-text-muted':  '#6b6e75',
        'd-text-dim':    '#3e4046',
        'd-gold':        '#ceae33',
        'd-gold-pale':   '#e8d57a',
        'd-gold-bright': '#f5d96e',
        'd-gold-dim':    'rgba(206,174,51,0.10)',
        'd-gold-hover':  'rgba(206,174,51,0.18)',
        'd-gold-line':   'rgba(206,174,51,0.45)',
        'd-keep':        '#5a9e6f',
        'd-keep-dim':    'rgba(90,158,111,0.12)',
        'd-keep-line':   'rgba(90,158,111,0.45)',
        'd-shard':       '#c23a3a',
        'd-shard-dim':   'rgba(194,58,58,0.12)',
        'd-shard-line':  'rgba(194,58,58,0.45)',
        'd-exotic':      '#d4af37',
        'd-exotic-dim':  'rgba(212,175,55,0.12)',
        'd-exotic-line': 'rgba(212,175,55,0.45)',
        'd-legendary':   '#9d71c7',
        'd-legendary-bright': '#c69cf0',
        'd-legendary-dim':  'rgba(82,47,101,0.18)',
        'd-legendary-line': 'rgba(157,113,199,0.45)',
        'el-solar':   '#f2721b',
        'el-void':    '#b185db',
        'el-arc':     '#79c8ec',
        'el-strand':  '#3ddc84',
        'el-stasis':  '#4d88ff',
        'el-kinetic': '#d0cece',

        // Brief #23: legacy tokens REMAPPED to the new palette so existing
        // components (DropLogPanel, RulesPanel, WeaponsPanel, etc.) inherit
        // the redesign automatically without per-file rewrites. The old
        // semantic intent stays — rahool-blue meant "accent" so it becomes
        // gold; bg-card meant "elevated panel" so it becomes d-bg-panel.
        // When the legacy components get rewritten in a later pass, these
        // alias mappings get deleted along with their callsites.
        bg: {
          primary: '#0c0e11', // was #0A0D12 — now matches d-bg-deep
          card:    '#1c1e22', // was #161B22 — now matches d-bg-panel
          border:  '#25282d', // was #23282F — now matches d-bg-elevated as a solid border value
        },
        text: {
          primary: '#e2e2e2', // was #E8EAED
          muted:   '#6b6e75', // was #8B95A1
        },
        rahool: {
          blue:   '#ceae33', // was #7FB3D5 (Rahool blue) — now gold
          yellow: '#d4af37', // was #D4A82C — now exotic-gold
        },
        grade: {
          s:      '#ceae33', // was #7C4DFF (S-tier purple) — now gold (god roll = gold)
          a:      '#9d71c7', // was #7FB3D5 (A-tier blue) — now legendary purple
          b:      '#6b6e75', // was #6B7280 — now text-muted grey
          exotic: '#d4af37', // was #CEAE33 — now d-exotic
        },
      },
      fontFamily: {
        outfit: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // Brief #23 follow-up: token scale bumped ~30% across the board after
        // user feedback that the previous scale read too small. Bump happens
        // here at the source so every callsite inherits without per-file edits.
        'd-9':  ['12px', { lineHeight: '1.2' }],
        'd-10': ['13px', { lineHeight: '1.2' }],
        'd-11': ['14px', { lineHeight: '1.3' }],
        'd-12': ['15px', { lineHeight: '1.3' }],
        'd-13': ['17px', { lineHeight: '1.3' }],
        'd-14': ['18px', { lineHeight: '1.4' }],
        'd-18': ['23px', { lineHeight: '1.2' }],
      },
      letterSpacing: {
        'd-wide':     '0.10em',
        'd-widest':   '0.15em',
        'd-headline': '0.22em',
        'd-hero':     '0.25em',
      },
      // Brief #23: flatten all `rounded`/`rounded-lg`/`rounded-md` etc. to 0.
      // `rounded-full` stays as 9999px so the circular perk icons keep their
      // circles. This overrides Tailwind's defaults rather than extending.
      borderRadius: {
        none:    '0px',
        sm:      '0px',
        DEFAULT: '0px',
        md:      '0px',
        lg:      '0px',
        xl:      '0px',
        '2xl':   '0px',
        '3xl':   '0px',
        full:    '9999px',
        'd-sm':  '2px',
      },
      transitionDuration: {
        'd-fast': '100ms',
        'd-base': '120ms',
      },
      keyframes: {
        // Drift the SacredBg layer via transform (GPU-composited) rather than
        // background-position — at slow speeds the browser snapped bg-position
        // to integer pixels and the drift read as a stepped/choppy crawl.
        // Translating exactly one tile size (480px) end-to-end loops seamlessly
        // since the tile repeats.
        'sacred-drift': {
          from: { transform: 'translate3d(0, 0, 0)' },
          to:   { transform: 'translate3d(-480px, -480px, 0)' },
        },
        'gold-shimmer': {
          '0%, 100%': { transform: 'translateX(-100%)' },
          '50%':      { transform: 'translateX(200%)' },
        },
      },
      animation: {
        // 90s end-to-end for one tile width — pixel speed effectively the same
        // as the previous 120s/480px setup (≈4-5 px/sec) but the transform
        // path interpolates smoothly so the perceived framerate is 60fps.
        'sacred-drift': 'sacred-drift 90s linear infinite',
        'gold-shimmer': 'gold-shimmer 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
