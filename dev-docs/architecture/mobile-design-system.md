# Mobile design system (`mobile/`)

> Status: design input for TASK-005. Source of truth for the dark palette and fonts is the web app (`apps/app/globals.css`, `apps/app/layout.tsx`); this file only says how `mobile/` reuses it. Decision record: ADR-006. Visual reference: `dev-docs/design/mobile/mock/`.

The mobile app must look like the same product as the web dashboard: same fonts, same dark palette, same logo, same severity colours. There is no shared package between `apps/` and `mobile/` (ADR-002: no shared workspaces), so the tokens are copied once into `mobile/src/index.css` and this file records the mapping.

---

## 1) Fonts

| Role | Family | Weights used | Where |
|---|---|---|---|
| Display | Big Shoulders | 600 to 900 | Titles, big numbers, wordmark; uppercase for page titles |
| Body | IBM Plex Sans | 400, 500, 600, 700 | All running text and controls |
| Mono | IBM Plex Mono | 400, 500, 600 | Eyebrows, codes, ids, units, addresses, timestamps |

The web app loads them with `next/font/google`. The mobile app is offline-first and a field app: **bundle the font files** (`@fontsource-variable/*` or self-hosted `woff2` under `mobile/src/assets/fonts`) instead of fetching from Google Fonts at runtime. Never rely on the network for first paint. Keep the fallback stack `system-ui, sans-serif` (mono: `ui-monospace, monospace`). The mock links Google Fonts only because the design canvas needs it.

Sizes in the mock (px at 390 wide): page title 44 to 58 (display, line-height 0.92 to 0.95, uppercase), big reading 56, section title 20, body 15 to 16, helper 13 to 14, eyebrow and chart labels 11 to 12 mono with 0.1 to 0.2 em tracking. Body text on inputs is 16 px minimum so Android does not zoom.

---

## 2) Colour tokens

Names are the mobile CSS variables; the web equivalents are in the last column. Dark values are identical to the web.

### Dark (default)

| Token | Value | Web token |
|---|---|---|
| `--bg` | `#0A0D10` | `--color-ink` |
| `--surface` | `#12161B` | `--color-panel` |
| `--surface2` | `#171C22` | `--color-panel-raised` |
| `--border` | `#232A32` | `--color-line` |
| `--border2` | `#323C47` | none (mobile only, stronger edge) |
| `--text` | `#E8ECF1` | `--color-paper` |
| `--muted` | `#7C8A97` | `--color-fog` |
| `--accent`, `--accent-text` | `#F5A623` | `--color-amber` |
| `--on-accent` | `#0A0D10` | `--color-ink` |
| `--cyan`, `--cyan-text` | `#22D3EE` | `--color-cyan` |
| `--ok`, `--ok-text`, `--ok-bg` | `#22C55E`, `#5FE0A0`, `#0F2A1D` | `--color-good` (text and bg tints are mobile only) |
| `--warn-text`, `--warn-bg` | `#F7B955`, `#2B1F0A` | `--color-warning` is `#F5A623` |
| `--crit`, `--crit-text`, `--crit-bg` | `#EF4444`, `#FF8A8A`, `#2D1215` | `--color-critical` |
| `--grid`, `--chart` | `#141A21`, `#22D3EE` | none |

### Light (proposed, needs approval: ADR-006 and open question 3 in `mobile-ui-spec.md`)

The web landing and login stay dark; the web dashboard has a slate-based light mode. The mobile light palette is new and was derived to keep the amber accent and pass contrast.

| Token | Value |
|---|---|
| `--bg` | `#F2F4F6` |
| `--surface` | `#FFFFFF` |
| `--surface2` | `#EBEEF2` |
| `--border` | `#DCE1E7` |
| `--border2` | `#B4BDC8` |
| `--text` | `#0D1319` |
| `--muted` | `#56616D` |
| `--accent` | `#F5A623` (fills only) |
| `--accent-text` | `#A85800` (amber used as text) |
| `--on-accent` | `#0A0D10` |
| `--cyan` / `--cyan-text` | `#0E8CA6` / `#00758C` |
| `--ok` / `--ok-text` / `--ok-bg` | `#16A45B` / `#0F6B3C` / `#E0F4E9` |
| `--warn-text` / `--warn-bg` | `#8A4B00` / `#FDEED2` |
| `--crit` / `--crit-text` / `--crit-bg` | `#D93636` / `#A8242A` / `#FCE4E3` |
| `--grid` / `--chart` | `#E4E8ED` / `#0A86A0` |

Rules: amber and cyan are accents, not backgrounds for text blocks. When amber is used **as text** in light mode use `--accent-text`; amber stays as a fill under `--on-accent` text in both themes. Severity is never colour alone: always the word (Normal, Warning, Critical) or an arrow plus the colour.

### Contrast (computed, WCAG 2.x relative luminance)

| Pair | Ratio |
|---|---|
| Dark: text on bg / muted on bg / muted on surface | 16.4 / 5.5 / 5.1 |
| Dark: accent on surface / cyan on surface / on-accent on accent | 9.0 / 10.1 / 9.6 |
| Dark: ok, warn, crit text on their tint | 9.2 / 9.2 / 7.7 |
| Light: text on bg / muted on bg / muted on surface | 16.9 / 5.7 / 6.3 |
| Light: accent-text on surface / on bg / cyan-text on surface | 5.2 / 4.7 / 5.4 |
| Light: ok, warn, crit text on their tint | 5.7 / 5.9 / 5.9 |

Every text pair is at least 4.5:1. Known gap: control edges (`--border2` on the page or card) are about 1.7:1 in dark and 1.9:1 in light, below the 3:1 guideline for non-text boundaries. Inputs also have a filled background, which carries most of the affordance; raise `--border2` if the field test shows trouble in sunlight. Logged as design backlog in TASK-014.

---

## 3) Theme behaviour

- Modes: dark (default), light. Class-based (`.dark` / `.light` on the app root), the same pattern as `apps/lib/useTheme.ts`. A first-run default follows the system setting only if the product decides so; otherwise dark.
- Persist the choice in `localStorage` under the key `everline-theme` (the mock uses the same key), inside `try/catch` because the WebView can deny storage. Render correctly with no stored value.
- Toggle: a 44 by 44 px round button in the top bar of every screen before the wizard, then in Settings once it exists. Label "Switch to light mode" or "Switch to dark mode".
- The Android status and navigation bars follow the theme (`@capacitor/status-bar`, text colour set per mode).

---

## 4) Shape, spacing, controls

| Item | Value |
|---|---|
| Screen gutter | 20 px |
| Card | `--surface`, 1 px `--border`, radius 8, padding 16 to 20 |
| Control radius | 6 (buttons, inputs, chips), 999 for round icon buttons |
| Primary button | `--accent` fill, `--on-accent` text, min height 54 to 56, weight 600, 16 px |
| Secondary button | transparent, 1 px `--border2`, `--text` |
| Text link | `--cyan-text`, 15 px, weight 500, min height 44 to 48 |
| Segmented control | `--surface2` track, padding 4, selected segment `--surface` with an inset 1 px `--border2`, `aria-pressed` |
| Switch | 52 by 32 track, 26 knob, `role="switch"`, whole 60 by 44 target |
| Inputs | min height 48 to 52, `--surface2`, 1 px `--border2`, text 16 px |
| Focus ring | 2 px `--cyan-text`, offset 2, on every `a`, `button`, `input` |
| Touch target | at least 44 by 44 px, including the back link and the theme toggle |

Layout: single column, the primary action pinned to the bottom (`margin-top:auto`), safe-area insets respected (`env(safe-area-inset-*)`). The mock is designed at 390 by 844; build with `100dvh` and flexible widths and check 360 by 640 and a large font setting. The mock was not tested at those sizes.

No emoji and no decorative icon fonts. Icons are inline SVG, stroke 2 to 2.5, round caps, `currentColor`, `aria-hidden` (the lucide set the web app uses is a fine source). Status marks inside docs use plain words.

---

## 5) Logo

- Source: `apps/public/logo.png`. In the web app it is a single-colour mark drawn through a CSS mask (`BrandMark.tsx`) so it takes the text colour in any theme.
- Copy the file once to `mobile/src/assets/logo.png` and use the same mask technique (`mask-image: url(...)`, `background: currentColor`). Do **not** ship the pre-tinted PNGs the mock embeds as blobs (`/_blob/...`); they exist only because the design canvas could not mask.
- Wordmark: "EverLine" in Big Shoulders 700, letter-spacing -0.01 em, mark and word share the text colour. App launcher icon: the mark on `#0A0D10` (generate adaptive icon layers from it; this is part of TASK-005).

---

## 6) Logo animation (`/welcome`, mock `Splash.dc.html`)

Played once after sign-in, about 2.9 s, then the app continues to the first unmet wizard step.

Values below are copied from the keyframes in `Splash.dc.html`; the mock is the reference if they ever differ.

| Start | Element | Effect |
|---|---|---|
| 0.1 s, 0.95 s long | Logo mark (`logoIn`) | From opacity 0, scale 0.55, 10 px low, overshoot to scale 1.07 at 60 percent, settle at 1. Easing `cubic-bezier(.2,.9,.3,1.15)` |
| 0 s, 1.1 s long, then loops every 2.6 s | Glow (`glowIn`, `glowPulse`) | Scale 0.6 to 1, then a slow pulse to 1.12 with opacity down to 55 percent |
| 0.5 s, loops every 2.4 s | Rings (`ringOut`) | Scale 0.7 to 2, opacity 0.55 to 0, ease-out |
| 0.75 s, 0.6 s long | Wordmark (`rise`) | Fade in and move up from 10 px |
| 0.95 s, 0.6 s long | Tagline (`rise`) | Same, staggered |
| 1.05 s, 1.1 s long (ends 2.15 s) | Pulse trace (`draw`) | SVG path drawn left to right with `stroke-dashoffset`, ease-in-out |
| 1.95 s, 0.4 s long | End dot (`pop`) | Scale 0 to 1.5 to 1, then a slow pulse |
| 0.4 s, 2.4 s long (ends 2.8 s) | Progress bar (`fill`) | `scaleX` 0 to 1 |
| about 2.9 s | Status text (`rise`) | "Signed in" |

Rules: transform and opacity only (no layout animation). The mock runs its animation only under `prefers-reduced-motion: no-preference`; in the app, with reduced motion show the final frame and advance after about 600 ms. The glow, ring and dot loops exist so the canvas screen can rest; in the app stop them when the screen is left. Never end the screen before initialisation finishes, and never wait for the animation if initialisation is slow (`mobile-ui-spec.md` section 3.1). The trace is the same pulse-line motif as the web landing hero.

---

## 7) Content rules

- Device name is **Cantol**; never "Red Pitaya" or "RP" in the UI.
- No "20kV", "Central Java" or "PLN" on the sign-in screen.
- Sentence case for controls; page titles uppercase in the display face.
- Units: dBmV for magnitude, dB for differences, m for distance, ms for RTT. One space between number and unit in prose; the mono face for readings.
- Error text says what happened and what to do next, with no codes unless in Diagnostics.
- No emojis anywhere in UI copy, code, docs or commit messages (`ai-rules/AGENTS.md`).
