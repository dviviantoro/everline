# CHANGELOG

> Living documentation — see `ai-rules/CHANGELOG-template.md` for the template this was generated from. Source input for `dev-docs/ai/VERSION.md`'s release recommendations.

---

## [Unreleased] — Current Sprint/Milestone

### Added — mobile: a demo build with every screen on simulated sources (TASK-015, 2026-10-21)
- ADR-007 (Accepted). `VITE_DEMO=1` (`npm run build:demo`, `scripts/android-build.sh demo`) selects the demo through a dynamic import, so a normal build is unchanged: it opens on the self-test only, with the same digest `f7f47846`, and none of the demo code, fixtures or fonts are in its bundle. The self-test shows one more row, `trend/cases`.
- All eleven mock screens, plus the manual-address and diagnostics screens behind the Cantol help card and a demo-only controls screen: sign in, welcome animation, hotspot, waiting for Cantol (60 s help card), enable GPS (denied, blocked, services off, poor fix), ready, live PD (phase plot, Ref locked), tracking setup and live (drafts, resume, optional sound cue), tag survey, surveys (saved, uploaded, failed with retry). Dark and light themes, bundled fonts, the logo through a CSS mask, reduced motion honoured.
- Everything outside the WebView sits behind interfaces in `mobile/src/core/links.ts` (`CantolLink`, `Gnss`, `HotspotAssistant`, `SurveyApi`) and a local store (Dexie). The demo implements them in `mobile/src/demo` with a seeded, deterministic simulation. It makes no network request and contains no API key; uploads are simulated. TASK-005 to TASK-007 add the real implementations behind the same interfaces.
- Real and tested, not simulated: the wizard as a pure reducer with a 30 s silent recovery, route guards and Android Back, the survey payload (checked against a hand copy of `pdSurveySchema`), the store (a saved survey is never edited, only its upload status), and the tracking walk replayed on the simulated scenario in both directions and both position sources.
- Tracking trend rules (window peak, live level and trend, segment trend, mark value, peak, guidance) added to `cantol-dsp` and exported through `cantol-wasm`, with `rust/vectors/trend/cases.txt` covering the exact boundaries. The self-test digest is unchanged: like the classify cases, the trend cases are checked but not hashed. Rust tests 42 to 52, WASM 26,849 to 29,580 bytes, Vitest tests 6 to 126.
- Android packaging, resources only (no Kotlin, no manifest change, no new permission): a launcher icon generated from the mark (`scripts/generate-icons.py`), a dark launch screen and system bars. Two Capacitor plugins added, `@capacitor/app` and `@capacitor/status-bar`; they are in the normal APK too. New runtime dependencies: Dexie, react-router, the `@fontsource` fonts (Latin woff2 only: Big Shoulders 700 and 900, IBM Plex Sans 400, 500 and 600, IBM Plex Mono 400 and 500); dev: zod and playwright-core.
- `npm run verify:demo` drives the demo in headless Chromium on a fake clock and checks every screen in dark and light at 390x844 and at 360x640 with a larger font (no text off the screen or clipped, touch targets at least 44x44), that no request leaves the local origin, and reduced motion. It found two real problems, fixed here: the welcome animation never played (the guard sent a signed-in user from `/login` straight to the wizard), and a 26 px high link on the Ready screen.
- Assumptions, all flagged in the code or the report: the window peak as `pd_magnitude`; a fix of 25 m or better to be ready and 10 m for GPS distance; auto-marking after seven still fixes within 3 m of a station, or on walking through it; the 20, 30 and 40 dBmV warning presets; a condition edit on a tracking walk applies to the strongest mark only. Not touched: `apps/`, `backend/`, `ai-rules/`, `planning/`, existing ADR text.

### Verified — mobile: Phase 0 self-test on a phone (TASK-004, 2026-10-21)
- The debug APK built from `feat/task-010-cantol-rename` (`626ab97`) was sideloaded on a Samsung SM-A127F running Android 13 (WebView Chrome 155.0.8059.43). The self-test shows PASS for `cantol-wasm 0.1.0 (protocol v1)`: all 9 decode vectors match the committed reports for 11 chunkings each, 10 magnitudes classify as committed, and the digest is `f7f47846`, equal to the Node run.
- Decoder throughput in that WebView: 0.839 ms per 64 KiB (74 MiB/s) against the 2 ms budget in `SelfTestScreen.tsx`. The 26,849-byte `.wasm` was served as `application/wasm`; total 113 ms. The WebView reports origin `https://localhost`, `webAssembly` true, `sharedArrayBuffer` false, `crossOriginIsolated` false, 8 cores, secure context true.
- One phone and one Android version only. The hotspot and Cantol-reachability spike and the VPS `CORS_ORIGIN` change are still open under TASK-004. No code changed.

### Changed — mobile: "Red Pitaya" and "RP" renamed to Cantol (TASK-010, 2026-10-21)
- ADR-006 is Accepted (2026-10-21). This is the code and living-docs rename it calls for.
- `mobile/rust/rp-mock` is now `mobile/rust/cantol-mock`: package, library (`cantol_mock`), binary (`cantol-mock`), workspace member, imports and tests. `Cargo.lock` was regenerated by cargo; only that package entry moved.
- Comments, crate descriptions, the mock's usage text, one test string, the self-test screen text and one `AndroidManifest.xml` comment now say Cantol. The `Pong` field `rp_epoch_ms` is now `cantol_epoch_ms`; it is a name only, the wire layout and the decode reports do not use it.
- Living docs updated: `mobile-app.md` (and its ADR-006 amendment note), `mobile-ui-spec.md` (tense only), `CURRENT_STATE.md`, `TECHNICAL_DEBT.md`, `TASKS.md`, `START_HERE.md`, `FINAL_SYSTEM_HANDOVER.md`. `build-apk.md` had nothing to change. ADR-002, ADR-003, earlier entries of this file, task reports and commit logs keep the old names as history.
- Kept on purpose: the device-id byte strings `RP-00A1` (inside the committed `clean_10.bin` golden vector; renaming it would change the payload CRC and the self-test digest), `RP-MOCK` (the id the mock advertises by default) and `RP-01` (a command-line test value). What the real device ids look like is for ADR-005 to decide.
- No behaviour change. Re-run after the rename: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, 42 Rust tests, `npm run typecheck`, `npm run lint`, 6 Vitest tests, self-test digest `f7f47846` (unchanged, no vector file touched) and the debug APK build.

### Added — mobile UX contract, design reference and handover (2026-10-21, docs only)
- ADR-006 (Proposed): the device is named Cantol in the UI and, via TASK-010, in code and living docs; the wizard order after sign-in is hotspot, Cantol, GPS (the separate permissions step is folded into the GPS screen); the app surveys line assets only, with "Line | Cable" meaning `line_type` `SUTM | SKTM`; magnitudes are dBmV with the existing provisional zones; fonts and the dark palette are copied from the web app; the light palette is proposed. ADR-002 and ADR-003 are left as written.
- New architecture files: `mobile-ui-spec.md` (screen to layer to API map, upload sequence, mock-versus-data-model table, design backlog, open questions), `mobile-tracking-mode.md` (stations along a span, trend rules, saving as one survey), `mobile-design-system.md` (fonts, tokens with computed contrast, controls, logo, welcome animation).
- New `dev-docs/design/mobile/` with a README and the 11-screen visual mock (Login, Splash, Hotspot, Pairing, Location, Connect, Live, TrackSetup, Tracking, Tag, Surveys). Visual reference only; its numbers are samples.
- Tasks TASK-010 (Cantol rename), TASK-011 (tracking mode), TASK-012 (refresh stale docs), TASK-013 (backend hardening), TASK-014 (second mock pass); TASK-005 to TASK-007 amended to point at the spec.
- `dev-docs/ai/START_HERE.md` and `FINAL_SYSTEM_HANDOVER.md` rewritten for the three-folder repository (the 2026-09-05 versions described a Next.js + Supabase monolith). The latter now carries the repository review findings and the decisions waiting on the user.
- No code, schema or API changed. `ai-rules/`, `planning/` and `schema.sql` untouched.

### Added — `mobile/`: Android field-capture app (Capacitor + Rust/WASM) for Red Pitaya PD data (Phase 0 started)
- New third code folder `mobile/` (Vite + React + TypeScript + Capacitor 8, with a Rust workspace compiled to WASM). The app brings up a link to a Red Pitaya over the phone's hotspot, receives PD data, tags it with GPS and uploads a PD survey to the existing `POST /api/assets/:id/pd-surveys`. Capture only; the Next.js dashboard is not touched.
- Design and decisions: `dev-docs/architecture/mobile-app.md`, ADR-002 (scope and stack), ADR-003 (hotspot topology and native-only transport, status Proposed until the Phase 0 spike on real phones). Tasks TASK-004 to TASK-009.
- Android has no public API to turn on the tethering hotspot or set its SSID/password, so v1 uses a guided one-time hotspot setup plus one toggle per session; the app detects the hotspot and proves the link with a handshake.
- `mobile/rust` (Cargo workspace, toolchain pinned to 1.97.1): `cantol-proto` (placeholder Red Pitaya protocol: frame layout, CRC32, streaming decoder that resyncs and reports identically for any chunking), `cantol-dsp` (severity zones matching the dashboard's provisional 20/40 dBmV), `cantol-wasm` (thin wasm-bindgen facade, 27 KB), `rp-mock` (simulated Red Pitaya: handshake, STATUS and PD event streaming, UDP beacon, loss/corruption/disconnect injection). Golden vectors in `mobile/rust/vectors` are the cross-target contract.
- `mobile/` app shell: Vite 8, React 19, Tailwind 4, Capacitor 8 (minSdk 24, target 36, `allowBackup` off, INTERNET only, no cleartext). Its one screen replays the vectors through the WASM module in a Web Worker and reports WebView version, CSS support, decoder speed and the `.wasm` Content-Type. Scripts: `scripts/env.sh` (pins JDK 21 and the Android SDK), `scripts/build-wasm.sh` (checks the wasm-bindgen CLI matches the crate), `scripts/ensure-wasm.mjs`, `scripts/android-build.sh`.
- Verified 2026-10-18: 42 Rust tests, 6 Vitest tests, typecheck, lint, production build and debug APK all green; the self-test passes in headless Chromium 153 with the same vector digest (`f7f47846`) as under Node. Not yet run on a phone.
- Known and accepted: 3 moderate dev-only `npm audit` advisories via `@capacitor/cli` (see TECHNICAL_DEBT).

### Changed — scope: mobile app, live telemetry and offline capture are no longer non-goals
- **This supersedes `planning/PROJECT_BRIEF.md` section 4** ("Native mobile app", "Real-time/live telemetry", "Offline data capture" as non-goals) and the "Monolith, don't split" note in `planning/CLAUDE.md`. Those planning files are marked immutable and were intentionally left as written; they document the original intent. Same handling as the earlier backend split. Not decided here: the same documents say "dummy data only" and "no real PLN asset data in this phase"; whether data captured by a real Red Pitaya on real lines counts as real asset data is an open question for the user, and until it is answered the app should only upload to the existing POC dataset.

### Changed — architecture split: self-hosted backend on a VPS, Vercel stays frontend-only
- **This supersedes `planning/architecture.md`'s "Monolith on Vercel + Supabase" description** (that file is marked immutable and was intentionally left as-is — it documents the original decision, not necessarily the current one). The user acquired a VPS and asked to move the database, API, and backend logic there, keeping only the Next.js frontend on Vercel; the tradeoff (this breaks `CLAUDE.md`'s "don't split it" non-negotiable) was flagged and the user confirmed they wanted the split anyway.
- New `backend/` — its own git repo (per `ai-rules/AGENTS.md`'s recognized "Fullstack" project type, `backend/`+`frontend/`), Express + TypeScript + raw `pg` (no ORM), a near-1:1 mechanical port of every former Next.js API route (same paths, same request/response shapes). Dockerized: `postgres:16-alpine` (schema auto-applied from `db/init.sql` on first boot — no more manual "paste into Supabase SQL Editor"), `quay.io/minio/minio` (S3-compatible object storage, replacing Supabase Storage for PD photo evidence — credentials never reach the browser now, the frontend uploads to the backend's `POST /api/uploads` instead of talking to storage directly), and `caddy:2-alpine` (reverse proxy + automatic HTTPS, required since Vercel serves the frontend over HTTPS and browsers block a plain-HTTP API as mixed content). See `backend/README.md` for the full VPS install walkthrough.
- Every backend route requires a shared `X-API-Key` header — not real auth (this POC has never had any), just a minimal safeguard now that the API is directly internet-exposed instead of sitting behind Supabase's infrastructure.
- Interactive API docs added: `swagger-jsdoc` + `swagger-ui-express`, served at `/docs` (UI) and `/docs.json` (raw OpenAPI spec) on the backend.
- `apps/` (frontend): removed `app/api/**` (all 14 route handlers), `lib/data/*.ts`, `lib/supabase.ts`, `lib/validation.ts`, `lib/supabaseStorage.ts`, and the `@supabase/supabase-js`/`zod` dependencies — this app now has zero server-side database access. New `lib/api.ts` (`apiFetch()`, attaches the API key, points at `NEXT_PUBLIC_API_BASE_URL`) is the one place every request goes through, client- and server-component-side alike. New `lib/uploadPhoto.ts` replaces the old direct-to-Supabase-Storage upload.
- Verified locally end-to-end before handoff: built the Docker image, brought up the full Compose stack (self-signed `localhost` cert via Caddy), ran the seed script inside the container, and smoke-tested health/auth/CRUD/CSV-import/photo-upload/public-photo-read through curl — then pointed a local frontend build at that same stack.

### Added (pole-first network model, CSV import/export, photo evidence, nav, theme)
- **Architecture change**: poles are now standalone network nodes (no `asset_id`/`sequence_no` — dropped in migration `004`), and a "power line" asset is exactly one span between 2 poles, never a multi-point route. Every existing multi-pole line was split into one segment per adjacent pole pair (e.g. a 3-pole line becomes 2 segments), each auto-named after its 2 endpoint poles (`assets.pole_a_id`/`pole_b_id`, both new columns)
- 3 PD measurement points are now sited between every such pole pair (previously 3 for a whole multi-pole line)
- CSV bulk import for all 3 asset types — poles (label/lat/lng), transformers (code/name/capacity/lat/lng/nameplate), and lines (resolves `pole_a_label`/`pole_b_label` against existing poles) — via a new generic `CsvImportForm` (`papaparse`) and `POST /api/import/{poles,transformers,lines}`; `AddAssetForm` gained a Manual/Import CSV toggle and a "Pole" type (poles are now directly addable, not just implied by line creation)
- PD measurements gained a device field (`pd_readings.pd_device`) and real photo evidence upload to a Supabase Storage bucket (`pd-photos`, public, created by hand — see migration `004`), via new `lib/supabaseStorage.ts`; shown inline (thumbnail + link to full size) in the Point Measurements view and the measurement point's map-click detail panel
- CSV export ("Export CSV" button) for transformer telemetry and PD measurement point reading history, via new client-side-only `lib/csv.ts` — no server round trip needed
- Sidebar nav gained Asset Registry (`/registry`, live table of all assets/poles), Reports (`/reports`, hub linking to the CSV exports), Settings (`/settings`), Profile (`/profile`), and Logout — new `StubPageShell` component shared by the 4 new pages
- Dashboard-wide light/dark theme toggle (`lib/useTheme.ts`, Tailwind v4 class-based `dark:` variant via `@custom-variant dark`), persisted per-viewer like the sidebar's collapse state; landing/login keep their fixed dark look by design. Recharts grid/axis/tooltip colors and Leaflet's popup chrome are also themed via CSS variables/overrides since neither is reachable by Tailwind's `dark:` classes
- `lucide-react` icons replace the sidebar's ad-hoc shape glyphs for nav/account items (layer-toggle shapes stay custom since they must visually match the map's own marker shapes)
- `planning/migrations/004_pole_network_model.sql`

### Added
- Next.js App Router monolith scaffolded in `apps/` (TypeScript, Tailwind CSS v4, `react-leaflet`, `@supabase/supabase-js`, `zod`)
- Dummy seed data: 8 transformers + 5 lines clustered in Pekalongan, Central Java, each with 2–3 historical surveys showing plausible trends (`scripts/seed.ts`, idempotent — safe to re-run via `npm run seed`)
- Landing page (`/`) with live asset stats pulled from Supabase, and a UI-only sign-in screen (`/login`) — no auth backend exists in this POC, so it's a gate only, not a real credential check
- `apps/patches/leaflet+1.9.4.patch` (via `patch-package`, wired to `postinstall`) fixing an upstream Leaflet bug
- Map view with severity-colored transformer markers and line polylines, plus a transformer/line layer toggle
- Asset detail panel with an expandable chronological survey history timeline
- Transformer survey form (insert-only write path)
- Line PD survey form with repeatable per-point rows (insert-only write path, whole patrol submitted as one survey)
- Add-asset form for registering a new transformer or line (renders immediately with a "no data yet" marker)
- API routes: `GET/POST /api/assets`, `GET/PUT /api/assets/{id}`, `POST /api/assets/{id}/transformer-surveys`, `POST /api/assets/{id}/pd-surveys`
- `planning/modules.md` and `planning/timeline.md`
- Full `dev-docs/ai/*` documentation set and this `CHANGELOG.md`
- Transformer nameplate fields (manufacturer, serial number, year, phase configuration, rated voltage/frequency, impedance %, cooling type) and a `transformer_telemetry` table for simulated IoT electrical readings (kWh, kVArh, kW, kVAr, kVA, PF, frequency, voltage, current, demand, THD) at ~5-minute intervals, with a metric-selectable time-series chart (`recharts`) in the transformer detail panel
- `poles` table giving each physical pole/tiang a stable identity along a line (previously only an ad-hoc label/lat-lng per survey); pole markers on the map (gray diamond, distinct from transformer circles) — a pole carries no reading itself, see `measurement_points` below
- `measurement_points` table — PD survey locations sited *between* poles (not at them), evenly spaced along a line's route (`interpolateAlongRoute()` in `lib/geo.ts`, 3 points per line); rendered as colored squares on the map (severity-colored, a 4th symbol distinct from transformers/poles/lines), each with its own reading history. `pd_readings` links to this via `measurement_point_id` (previously, incorrectly, linked to `poles` — see Fixed)
- `planning/migrations/002_nameplate_poles_telemetry.sql` and `003_measurement_points.sql` — one-time migrations for the above, applied by hand via Supabase SQL Editor (no migration runner in this POC)
- Collapsible left sidebar on the dashboard (`DashboardSidebar`) with navigation, layer toggles (Transformers/Lines/Poles/Measurements), a symbol/severity legend, and the Add Asset trigger — replaces the header's layer toggle
- App icon (`apps/app/icon.png`, from `wire.png`) replacing the default Next.js favicon
- `CollapsibleSection` component — Nameplate/Live Telemetry/Survey History on a transformer's detail panel, and Point Measurements/Survey History on a line's, are now independently collapsible
- `GET /api/assets/{id}/points` + `getMeasurementPointDetailsForAsset()` — every measurement point along a line with its own full PD reading history, powering a per-point "last measurement + history graph" view (`LinePointsPanel`) on the line detail panel
- Latitude/longitude now shown alongside every measurement: the transformer's position in its Live Telemetry section, each PD point's position in both the Point Measurements view and Survey History entries

### Changed
- App logo: the header/sidebar brand mark is now the `wire.png` artwork recolored amber (`#f5a623`, matching the landing page) via a CSS mask (`BrandMark` component) instead of a plain "E" letter badge — the raw glyph is solid black and was nearly invisible on the dark login panel
- Pole detail panel simplified to identity/location info only (label, line, sequence no., lat/lng, registered date) — no severity, no charts. PD magnitude/temperature history now lives on `measurement_points` instead, surfaced via the line's Point Measurements view and a measurement point's own map-click detail panel
- `app/dashboard/page.tsx` (formerly `app/page.tsx`) forced to dynamic rendering (`export const dynamic = "force-dynamic"`) so the map always reflects live Supabase state instead of a build-time snapshot
- The map app moved from `/` to `/dashboard` to make room for the new landing page; whole app given a dark industrial theme (Big Shoulders Display + IBM Plex Sans/Mono, amber/cyan accents), first branded "GARDU" and then renamed to **"EverLine"**
- Seed data area moved from Semarang to Pekalongan; asset codes changed from `-SMG-` to `-PKL-`
- `LinePdSurveyForm`/`PointRowInput` now let a surveyor pick a registered measurement point per row instead of free-typing a label and coordinates (falls back to a "custom point" entry when none is on file)
- `AddAssetForm`: line creation now labels each route point (feeds `poles`) and auto-sites 3 `measurement_points` along the route; transformer creation has an optional nameplate-details disclosure

### Fixed
- `transformer_readings` PostgREST embed was read as an array but is actually returned as a single object (it has a `UNIQUE` FK to `surveys`, unlike `pd_readings` which is genuinely one-to-many) — every transformer showed "no data yet" until fixed in `lib/data/assets.ts` and `app/api/assets/[id]/route.ts`
- Map click hit-testing: a `Polyline` rendered after a transformer marker could intercept clicks meant for that marker when the two visually overlapped; lines now render before markers in `MapView.tsx`
- Dev server was unreachable when opened via a forwarded/LAN URL instead of `localhost` — Next.js blocks cross-origin requests to dev-only JS resources by default, so every client component (including the map) silently failed to mount; fixed with `allowedDevOrigins` in `next.config.ts`. That fix later went stale on its own (hardcoded LAN IP from a since-changed network re-triggered the exact same "stuck forever on 'Loading map…', zero console errors" symptom) — `allowedDevOrigins` now computes the machine's current LAN IPs at server startup via `os.networkInterfaces()` instead of hardcoding one
- PD readings were modeled as linking to `poles` — wrong: a pole is a support structure with no reading, the actual measurement location sits *between* poles. Split into a separate `measurement_points` entity (`pd_readings.pole_id` → `measurement_point_id`, migration `003_measurement_points.sql`)
- "Add Asset" button appeared completely unresponsive (no visible modal, no console error) — the modal overlay (`MapApp.tsx`) had no explicit `z-index`, and Leaflet's own controls (`.leaflet-top`/`.leaflet-bottom`, z-index 1000) escape into the shared stacking context because the map container establishes none of its own, silently painting over the modal even though it was correctly mounted and interactive in the DOM. Fixed with `z-[1100]` on the overlay
- Upstream Leaflet 1.9.4 bug (`Cannot read properties of undefined (reading '_leaflet_pos')`, missing a null-check in `getPosition()` that was fixed upstream but never released to npm) — patched via `patch-package`
- Stray `body { font-family: Arial }` rule left over from the `create-next-app` scaffold was silently overriding the intended font the whole time (unlayered CSS beats Tailwind's layered utilities) — removed
- A negative `z-index` on a decorative hero SVG escaped its intended stacking context and painted entirely behind the page's opaque background, making it invisible — fixed with `isolate` on the containing section

---

## Template Entry (Copy for New Release)

```markdown
## [{versi}] — {YYYY-MM-DD}

### Added
- 

### Changed
- 

### Fixed
- 

### Removed
- 

### Security
- 
```

---

## Archived Changelogs

None yet.
