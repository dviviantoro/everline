# Mobile design reference

Visual reference for the Android field app (`mobile/`). It is not code and nothing builds from it.

| Item | Where |
|---|---|
| Screen contract (what each screen means, API mapping, wizard states) | `dev-docs/architecture/mobile-ui-spec.md` |
| Tracking mode | `dev-docs/architecture/mobile-tracking-mode.md` |
| Fonts, colours, controls, logo animation | `dev-docs/architecture/mobile-design-system.md` |
| Decision record (Proposed) | `dev-docs/decisions/006-mobile-ux-contract.md` |
| Mock screens | `mock/*.dc.html` |

## The mock

Eleven screens, each a standalone `.dc.html` file (390 by 844 px) from a design canvas:

| File | Screen |
|---|---|
| `Login.dc.html` | 1 Sign in |
| `Splash.dc.html` | 1b Signed in (logo animation) |
| `Hotspot.dc.html` | 2 Enable hotspot |
| `Pairing.dc.html` | 3 Waiting for Cantol |
| `Location.dc.html` | 4 Enable GPS |
| `Connect.dc.html` | 5 Ready |
| `Live.dc.html` | 6 Live PD |
| `TrackSetup.dc.html` | 6b Tracking setup |
| `Tracking.dc.html` | 6c Tracking live |
| `Tag.dc.html` | 7 Tag survey |
| `Surveys.dc.html` | 8 Surveys |

Each file reads the theme from `localStorage` key `everline-theme` and has a sun/moon toggle. They need the canvas runtime (`support.js`) to render, which is not committed, and their logo images point at `/_blob/...` paths that only exist inside the design tool, so outside it the pages do not render and the logo is missing. To look at them, open the design artifact the user shared, or read the markup directly. The flow links between files (for example Login to Splash to Hotspot) are for prototype navigation only.

## Rules for using it

1. The mock is a picture of the intent. Numbers on it (mV values, "182 mV", "4 m", "EverLine-PD", asset codes `LN-0092`, the device address `192.168.43.112`, a private-range sample) are samples. The real unit is dBmV and the real data comes from the API, the device profile and Cantol.
2. Where the mock disagrees with `mobile-ui-spec.md`, the spec wins. The known differences are tabulated in section 4 of that file.
3. Do not copy the embedded logo blobs (`/_blob/...`). Use `apps/public/logo.png` through a CSS mask.
4. The mock loads fonts from Google Fonts for the canvas. The app bundles them.
5. Nothing secret belongs here. The hotspot name and password shown are placeholders; real values live in the gitignored device profile.
6. Changes to the design go through TASK-014 (second mock pass) and update the spec in the same batch.

## Provenance

Made 2026-10-21 with Claude from the live site's styling and the repository's tokens, then corrected to use the repository's fonts and dark palette. The font swap was not checked visually for text overflow (IBM Plex Sans is wider than the fallback used earlier); check that first when the mock is reopened.
