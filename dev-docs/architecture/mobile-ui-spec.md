# Mobile UI contract (`mobile/`)

> Status: accepted design input, implementation not started (Phase 0 foundations exist; the wizard and everything after it are TASK-005 onward). Decision record: ADR-006. Visual reference: `dev-docs/design/mobile/mock/*.dc.html`. Technical design of the layers: `dev-docs/architecture/mobile-app.md`. Companion files: `mobile-tracking-mode.md`, `mobile-design-system.md`.
>
> The mock shows what each screen looks like. This file says what each screen means in the real system: which API field, which wizard state, which native plugin. Where the two disagree, this file wins (see "Mock versus data model").

---

## 1) Ground rules

| Rule | Detail |
|---|---|
| Device name | The device is **Cantol**. The words "Red Pitaya" and "RP" never appear in UI copy. Code and living docs were renamed by TASK-010 (done 2026-10-21); ADR-002 and ADR-003 keep their original wording as history. |
| Assets | The app only surveys `type = "line"` assets. A line is one span between two poles. "Line | Cable" in the UI is the asset's `line_type`: **Line = `SUTM`** (overhead), **Cable = `SKTM`** (underground cable). Transformers and poles never appear in the mobile app. |
| Condition | Normal, Warning, Critical = API `severity` values `normal`, `warning`, `critical`. |
| Unit | PD magnitude is **dBmV** (`pd_unit = "dBmV"`), the unit the API, the seed data and the dashboard use. Numbers in the mock (mV, "182 mV") are illustrative and must not be copied. |
| Thresholds | Provisional zones only: warning from 20 dBmV, critical from 40 dBmV (`mobile/rust/cantol-dsp/src/severity.rs`, `apps/lib/severity.ts`, `backend/scripts/seed.ts`). Do not add a fourth copy; call the WASM `classify`. Any new number is flagged "Assumption" (`planning/PROJECT_BRIEF.md` section 16). |
| Insert-only | The app only ever creates surveys. It never edits or deletes one. |
| Secrets | Hotspot name and password, API key and signing keys live in gitignored local files. Nothing secret appears in a committed file, including the mock. |
| No landing page | The app starts at Sign in. The marketing landing page stays on the website. |

---

## 2) Screen to layer map

Wizard states are the ones in `mobile-app.md`, with two amendments recorded in ADR-006: the `RP_*` states of ADR-003 became `CANTOL_*` (renamed by TASK-010), and the separate `PERMS` state is folded into `LOCATION` (the location permission is requested on the GPS screen, which gives the order the product asked for: hotspot, then Cantol, then GPS).

| # | Mock file | Route | Wizard state | Built in | Reads | Writes |
|---|---|---|---|---|---|---|
| 1 | `Login.dc.html` | `/login` | none | TASK-005 | none | local operator name |
| 1b | `Splash.dc.html` | `/welcome` | none | TASK-005 | none | none |
| 2 | `Hotspot.dc.html` | `/setup/hotspot` | `HOTSPOT_CHECK`, `HOTSPOT_GUIDE` | TASK-005 | `HotspotAssistant` (capabilities, hotspot on/off) | none |
| 3 | `Pairing.dc.html` | `/setup/cantol` | `CANTOL_DISCOVER`, `CANTOL_PING` | TASK-005 | `CantolLink` (found, HELLO/PONG, RTT) | none |
| 4 | `Location.dc.html` | `/setup/gps` | `LOCATION` | TASK-005 | `GnssHelper`, `@capacitor/geolocation` | none |
| 5 | `Connect.dc.html` | `/device` | `STREAMING`, `READY` | TASK-005 | all of the above | none |
| 6 | `Live.dc.html` | `/live` | `READY` | TASK-006 | `cantol-wasm` Session (events, summary) | none |
| 6b | `TrackSetup.dc.html` | `/track/setup` | `READY` | TASK-011 | `GET /api/assets?type=line`, `GET /api/assets/{id}/measurement-points` | none |
| 6c | `Tracking.dc.html` | `/track` | `READY` | TASK-011 | live Session, GPS | local session |
| 7 | `Tag.dc.html` | `/tag` | `READY` | TASK-007 | assets, measurement points, GPS | Dexie, then `POST /api/uploads`, `POST /api/assets/{id}/pd-surveys` |
| 8 | `Surveys.dc.html` | `/surveys` | none | TASK-007 (list), TASK-009 (queue states) | Dexie | retry upload |

Bottom navigation (Device, Live, Surveys) shows on `/device`, `/live` and `/surveys` only.

Guards, in order: no operator name stored then `/login`; wizard not at `READY` then the first unmet `/setup/*` step (every step is idempotent and all checks run in parallel on start and on app resume); link lost for more than 30 s on `/live` or `/track` then return to the wizard (the first 30 s recover silently, as in `mobile-app.md`). Android back button: on `/track` ask before leaving; on `/device` exit the app; elsewhere navigate back.

---

## 3) Screen contracts

### 3.1 `/login` and `/welcome` (screens 1 and 1b)

- Matches the web `/login`: a UI-only gate with no auth backend (`planning/PROJECT_BRIEF.md` section 4, `apps/app/login/page.tsx`). Any non-empty email and password continue. Do not invent tokens, refresh flows or a login endpoint.
- The email is stored locally and sent as `surveyor` on every survey (`surveyor` is required by `pdSurveySchema`). If the product later wants a display name, add it as a field; do not parse the email.
- Copy: eyebrow "Field Survey Network", title "Every reading, on record.", no "20kV", "Central Java" or "PLN" on this screen. The note "Internal proof-of-concept: any email and password will do." is shown only in a POC build flag.
- "Skip sign-in" exists in the mock for review only. Ship it only behind a development flag.
- `/welcome` plays the logo animation (`mobile-design-system.md` section 6). While it plays: open Dexie, run the first wizard checks in parallel. Advance when the animation has ended **and** initialisation is done, to the first unmet wizard step. With reduced motion, skip the animation and advance after about 600 ms. The manual "Continue" button in the mock exists so the screen can rest on a design canvas; keep it visible after the animation ends for accessibility.

### 3.2 `/setup/hotspot` (screen 2, step 1 of 3)

- Content: title "Turn on your hotspot.", a card "Set your hotspot to" with network name, band (2.4 GHz) and password (masked, Copy button), an Off/On status pill, primary "Open hotspot settings", then "Continue".
- Values come from the gitignored device profile (`mobile/config/device-profile.local.json`) through the single loader function in ADR-003. The mock's "EverLine-PD" is a placeholder. The password is displayed to the operator and never sent anywhere or logged.
- "Open hotspot settings" calls `HotspotAssistant` and walks its ordered intent table (ADR-003, strategy S3). Status On/Off comes from strategy S0 (an up AP-style interface with a site-local IPv4). Detection is best effort: allow "Continue anyway", because the final proof is Cantol reachability on the next screen.
- Setup card reminders from ADR-003: 2.4 GHz, hotspot auto-off disabled, phone Wi-Fi client off.

### 3.3 `/setup/cantol` (screen 3, step 2 of 3)

- Content: title "Waiting for Cantol." then "Cantol connected."; phone to Cantol graphic (pulsing ring while waiting, solid line and check when joined); checklist rows "Hotspot on", "Cantol joins hotspot", "Data link".
- Mapping: "Cantol joins hotspot" = a candidate found by discovery (last known IP, UDP beacon, /24 scan; ADR-003 item 3). "Data link" = HELLO/PONG handshake succeeded (protocol version accepted, median RTT of 3).
- After 60 s without a candidate show a help card (is Cantol powered, is its Wi-Fi set to the hotspot) with two actions: "Enter IP manually" and "Diagnostics". Both are in the design backlog (section 6) because the mock does not show them.
- The 5-second timer in the mock is a prototype stand-in. Never simulate success in the app.

### 3.4 `/setup/gps` (screen 4, step 3 of 3)

- Content: title "Enable location." then "Location found."; radar graphic; rows GPS, Location access, Accuracy (from the real fix, not a constant); primary "Enable GPS".
- "Enable GPS" requests the location permission, then asks `GnssHelper` to ensure location services are on (Play Services dialog, settings fallback). If the permission is permanently denied, show "Open app settings".
- Ready when a fix arrives with accuracy at or below 25 m (Assumption: the product has not set a minimum accuracy; the mock shows 4 m as sample data).

### 3.5 `/device` (screen 5, "Ready to measure.")

- Rows: Hotspot (name, band, On), Cantol (address, RTT, Connected), Location (accuracy, On). Each row reflects live state and turns into an actionable warning if lost.
- Primary "Start measurement" goes to `/live` and sends the Start frame to Cantol.

### 3.6 `/live` (screen 6)

- Header: "Live PD", sub-line with the Cantol device id and RTT, a Connected pill. Segmented control "Spot reading | Tracking mode" (the second goes to `/track/setup`).
- Plot: phase-resolved PD (PRPD), 0 to 360 degrees against calibrated dBmV, from `PdEvent.phase` (0..65535 maps to 0..360 degrees) and `amp_counts` after calibration. The chip "Ref locked" is `Status.flags` bit `STATUS_MAINS_LOCK`. If not locked, phase is meaningless: show "Ref not locked" and hide the phase plot, keep the numeric tiles.
- Tiles: Peak (window maximum, dBmV), Rate (`Status.trigger_rate_hz`, per second), Noise (`Status.noise_floor_counts`, calibrated to dBmV).
- Dependency: this screen needs pulse events with phase, so it depends on the decision gate before TASK-006 (where detection runs). If Cantol only sends final numbers, drop the plot and keep the tiles.
- "Record 60 s": the phone computes a 60 s window summary and its severity (`cantol-dsp`), builds a `Measurement` (summary, severity, GPS snapshot) in Dexie, then goes to `/tag`.
- "Capture waveform" is **deferred**: the protocol has a `Waveform` frame but the API and `pd_readings` have no field for it. Do not ship the button until a destination exists.

### 3.7 `/track/setup` and `/track` (screens 6b and 6c)

Specified in `mobile-tracking-mode.md`. Summary: the operator picks a line asset (a span between two poles), walks along it, and the app shows whether the PD magnitude is rising or falling and where the strongest reading was.

### 3.8 `/tag` (screen 7)

The mock shows a minimal form. The real form is the API's survey, so it needs more than the mock shows (section 4). Field mapping:

| UI | API field (`pdSurveySchema`) | Notes |
|---|---|---|
| operator email | `surveyor` | required |
| phone clock | `surveyed_at` | ISO 8601. Cantol has no clock; the phone stamps all times (`mobile-app.md`). |
| Note | `notes` | at most 2000 characters |
| selected measurement point | `points[0].measurement_point_id` | only a point with this set feeds the point's history and aging rate |
| point label | `points[0].point_label`, `sequence_no` | label from the measurement point |
| GPS fix | `points[0].latitude`, `longitude` | required |
| recorded value | `points[0].pd_magnitude`, `pd_unit = "dBmV"` | statistic is an open question (section 7) |
| Condition | `points[0].severity` | default from `classify`, operator can change it |
| Cantol profile name | `points[0].pd_device` | the seed uses `Cantol-Mobile V1` |
| optional photo | `points[0].photo_url` | upload first with `POST /api/uploads` (multipart field `file`, max 10 MB), then send the returned URL |
| optional temperature | `points[0].temperature_c` | operator-entered asset temperature, not Cantol's board temperature |

Asset choice: "Line | Cable" filters `GET /api/assets?type=line` by `line_type` (SUTM or SKTM). The ID control is a searchable list of asset `code` values (for example `SUTM-PKL-03`), sorted by distance from the GPS fix to the line's route. After choosing a line, `GET /api/assets/{id}/measurement-points` returns its points (three per span, sited at 25, 50 and 75 percent of the route); preselect the nearest to the fix and let the operator change it. The sample codes in the mock (`LN-0092`, `CB-0142`) are invented.

Save writes to Dexie first. Phase 4 uploads online only; offline retry waits for TASK-008 (idempotency, transaction, honest status codes) and TASK-009.

### 3.9 `/surveys` (screen 8)

- Lists locally saved surveys: asset code, kind (Line or Cable from `line_type`), mode (Spot or Tracking), condition pill, upload state.
- Phase 4 states: Saved, Uploaded, Failed (retry manually). The "N waiting to sync" banner and "Sync now" in the mock are Phase 5 (TASK-009).
- History of earlier surveys on the server is not shown in the app; that is the dashboard's job.

---

## 4) Mock versus data model (apply these when implementing)

| Topic | Mock shows | Real contract | Action |
|---|---|---|---|
| Unit | mV, "182 mV", "50/100/150 mV" | dBmV, zones 20 and 40 | Use dBmV. Mock numbers are samples. |
| Warning level chips (tracking setup) | 50, 100, 150 mV | none exist | Use presets 20, 30, 40 dBmV (20 and 40 are the caution and danger bounds). Assumption. |
| Asset ID | free text, `LN-`/`CB-` | `code` of a line asset, `SUTM-`/`SKTM-` | Searchable list from the API. |
| Line / Cable | two asset kinds | one kind, `line_type` | Segmented control filters by `line_type`. |
| Measurement point | absent | required to feed history | Add a picker on Tag (design backlog). |
| Photo, temperature | absent | optional fields exist | Add optional rows on Tag (design backlog). |
| Sign in | email and password | UI gate, no backend | Keep as a gate. |
| Waveform capture | button on Live | no API field | Defer. |
| Hotspot name | "EverLine-PD" | from device profile | Placeholder only. |
| Fonts and colours | Big Shoulders, IBM Plex Sans, IBM Plex Mono and tokens equal to `apps/app/globals.css` | same | Matches after the 2026-10-21 correction. Light palette is new (needs approval, ADR-006). |
| Marks | M1 to M4 at 45 m spacing | a span has three measurement points at 25, 50, 75 percent, between poles A and B | See `mobile-tracking-mode.md`. |

---

## 5) Upload sequence

1. If a photo exists: `POST /api/uploads` (multipart `file`), keep the returned `url`.
2. `POST /api/assets/{id}/pd-surveys` with the body below. Every request carries `X-API-Key`. Omit optional fields instead of sending `null`.
3. On `201`, mark the local survey Uploaded and keep `survey_id`. On any other status keep it Failed with the message. Until TASK-008 every error is HTTP 500, so do not auto-retry (a retry can create a duplicate survey).

```json
{
  "surveyor": "operator@example.com",
  "surveyed_at": "2026-10-21T04:12:09.000Z",
  "notes": "Spot reading, 60 s window.",
  "points": [
    {
      "measurement_point_id": "<uuid>",
      "sequence_no": 2,
      "point_label": "P2",
      "latitude": -6.8891,
      "longitude": 109.6759,
      "pd_magnitude": 33.4,
      "pd_unit": "dBmV",
      "severity": "warning",
      "pd_device": "Cantol-Mobile V1"
    }
  ]
}
```

Required pre-work on the VPS: add `https://localhost` (the Capacitor WebView origin) to `CORS_ORIGIN` in `backend/.env`, then `docker compose up -d`. An origin missing from the list gets HTTP 500 with no CORS headers (KNOWN_ISSUES 4).

---

## 6) Design backlog (not in the mock yet)

| Item | Why |
|---|---|
| Tag: asset picker, measurement point picker, optional photo and temperature rows | Needed by the API contract (section 4) |
| Pairing: "Enter IP manually" and "Diagnostics" | Discovery can fail (ADR-003 item 3) |
| Permission-denied and location-services-off states on `/setup/gps` | The only Android runtime permission in the default build |
| Link-lost banner on `/live` and `/track` | `mobile-app.md` recovery rule |
| Units pass on the whole mock (dBmV, dB deltas) | Mock numbers are in mV |
| Empty, loading and error states for the asset list | Lists come from the network |
| Settings: theme, sign out, app version | Not in the mock |

Tracked as TASK-014.

---

## 7) Open questions for the user

| # | Question | Needed by |
|---|---|---|
| 1 | Which statistic is `pd_magnitude` for a 60 s record: window peak, 95th percentile, or something else? It must match what the dashboard's seed data and aging-rate regression assume. | TASK-006 |
| 2 | Where does pulse detection run (Cantol or phone)? Decides whether the PRPD plot exists. | Before TASK-006 |
| 3 | Is the light theme palette (`mobile-design-system.md`) approved? The web dashboard has light mode but the landing and login stay dark; the mobile light palette is new. | TASK-005 |
| 4 | Minimum GPS accuracy to allow a survey (25 m is an assumption). | TASK-005 |
| 5 | Is data captured by a real Cantol on real lines "real PLN asset data"? Until answered, upload only to the existing POC dataset (already open in CURRENT_STATE). | Before TASK-007 |
| 6 | Operator identity: is the sign-in email enough as `surveyor`, or does the product want a display name? | TASK-005 |

---

## 8) Acceptance (per screen, on a phone)

- ✅ Every screen renders in dark and light, with the theme persisted across restarts.
- ✅ Every interactive element is at least 44 by 44 px and has a visible focus ring.
- ✅ With "reduce motion" on, no animation runs and every flow still works.
- ✅ No string contains "Red Pitaya", "RP", "pole" or "transformer" in the mobile UI.
- ✅ A survey saved on the phone appears on the dashboard for that line, in the point's history, with `pd_unit` "dBmV" and the chosen severity.
- ✅ Saving never modifies an existing survey (standing UAT).
