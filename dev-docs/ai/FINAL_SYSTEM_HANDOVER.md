# FINAL_SYSTEM_HANDOVER

> Living documentation — see `ai-rules/dev-docs-ai-templates/FINAL_SYSTEM_HANDOVER-template.md` for the template this was generated from. This file may be included in `main` as a handover reference — it contains no credentials, IPs, or secrets. Replaces the 2026-09-05 version, which described a single Next.js + Supabase app.

---

## System Identity

| Repo | Branch | Version | Last Commit |
|------|--------|---------|--------------|
| `everline` (project root: `apps/`, `backend/`, `mobile/`, docs) | `master` | apps `0.1.0`, backend `0.1.0`, mobile `0.1.0` (all unreleased) | `dd95242` (the handoff batch described below sits on top of it) |

| Project Type | Fullstack: three code folders in one git repository |
| Last Updated | 2026-10-21 |
| Handover Agent | Claude Sonnet 5.5 |
| Basis | Read-only review of the repository at `dd95242` plus the mobile UX design work of 2026-10-21. Nothing was run on a phone, a VPS or a Vercel project from this session. |

---

## Current Architecture Summary

Three code folders share one git repository.

- **`apps/`, web dashboard (frontend only).** Next.js 16 App Router, React 19, Tailwind 4, react-leaflet map, Recharts. Landing, UI-only `/login`, `/dashboard` map with asset detail and history, forms for transformer and line PD surveys, Asset Registry, CSV import and export, light/dark theme. It has no database access: every request goes through `apps/lib/api.ts`, which reads `NEXT_PUBLIC_API_BASE_URL` and attaches `X-API-Key`. Live on Vercel at https://everline-pi.vercel.app/.
- **`backend/`, API.** Express + TypeScript + raw `pg` + zod, one near-1:1 port of the former Next.js routes. Docker Compose runs `postgres:16-alpine` (schema auto-applied from `db/init.sql` on first boot), MinIO (S3-compatible, PD photo evidence, public-read bucket `pd-photos`) and Caddy (automatic HTTPS). Every route needs the shared `X-API-Key`. CORS is an allow-list in `CORS_ORIGIN`. Swagger UI at `/docs`. `backend/README.md` has the VPS install.
- **`mobile/`, Android field-capture app (Phase 0 only).** Vite 8, React 19, Tailwind 4, Capacitor 8.5 (minSdk 24, target 36, INTERNET only, `allowBackup` off, no cleartext). A Rust workspace (`cantol-proto`, `cantol-dsp`, `cantol-wasm`, `rp-mock`) compiles to a 27 KB WASM module that runs in a Web Worker. The app currently has one screen, a WASM self-test. Designed but not built: connection wizard, live pipeline, tracking mode, tagging and upload, offline queue. See ADR-002, ADR-003, ADR-006 and the `mobile-*` architecture files.

Data model (authoritative: `planning/schema.sql`, `backend/src/types.ts`):

- Assets: `transformer`, `line`, plus poles as standalone network nodes. A `line` asset is exactly one span between two poles (`pole_a_id`, `pole_b_id`) with `line_type` `SUTM` (overhead) or `SKTM` (cable) and three measurement points sited at 25, 50 and 75 percent of the route.
- History is insert-only: `surveys`, `transformer_readings`, `pd_readings`. A PD survey has one or more points; a point may reference a `measurement_point_id`, which is what feeds that point's history and the aging-rate regression.
- PD magnitude unit is `dBmV`. Severity (`normal`, `warning`, `critical`) is operator-entered; provisional zones are 20 and 40 dBmV in three code locations.
- Photos: multipart `POST /api/uploads` (max 10 MB), then the returned URL goes into the point.

Mobile data flow (target): Cantol sensor joins the phone's hotspot; a Kotlin plugin speaks raw TCP/UDP to it and passes bytes up; the Worker runs the WASM decoder and calculator; the UI shows live level; the operator tags a survey (GPS from Android); it is stored in Dexie and posted to `POST /api/assets/{id}/pd-surveys`. Cantol has no clock; the phone stamps all times.

---

## Active Modules Status

| Module | Repo | State | Notes |
|--------|------|-------|-------|
| Seed data, Asset Map, Detail and History, Transformer and PD Surveys, Asset Registry, CSV import/export, Photo evidence, Sidebar, Theme | apps + backend | Beta | Verified manually in September and October; no automated tests |
| Landing, Login | apps | Beta | Login is a UI-only gate |
| Backend / API split | backend | Beta | Built and verified locally in Docker. Deployment to the real VPS is not confirmed in any document (see Deployment Notes) |
| Mobile Rust workspace | mobile | Alpha | 42 native tests; golden vectors give digest `f7f47846` natively, in Node and in headless Chromium. Protocol is a placeholder (ADR-005 to be written) |
| Mobile app shell | mobile | Alpha | Debug APK builds on JDK 21. Self-test not yet run in an Android WebView on a phone |
| Mobile sign-in, welcome animation, theme | mobile | Designed | `mobile-ui-spec.md`, `mobile-design-system.md`; TASK-005 |
| Mobile connection wizard (hotspot, Cantol, GPS) | mobile | Designed | ADR-003 and `mobile-ui-spec.md`; TASK-005; needs the phone spike (TASK-004) |
| Mobile live PD screen | mobile | Designed, gated | Needs the decision on where pulse detection runs; TASK-006 |
| Mobile tracking mode | mobile | Designed | `mobile-tracking-mode.md`; TASK-011 |
| Mobile tag, upload, survey list | mobile | Designed | `mobile-ui-spec.md` sections 3.8, 3.9 and 5; TASK-007 |
| Backend ingest hardening | backend | Planned | TASK-008 |
| Mobile offline queue, release signing, per-device key | mobile | Planned | TASK-009 |
| Auth / RBAC | apps + backend | Planned | Deferred per `planning/PROJECT_BRIEF.md` section 5 |

---

## Recent Changes (Since Last Handover)

The previous handover was written 2026-09-05. Full detail: `dev-docs/CHANGELOG.md` `[Unreleased]`.

| Date | Repo | Type | Description | Impact |
|------|------|------|-------------|--------|
| 2026-09-06 | apps | feat | Nameplate fields, simulated transformer telemetry, poles as first-class entities with PD history graphs, collapsible sidebar, EverLine branding | Dashboard became multi-panel |
| Sep to Oct 2026 | apps + backend | feat | Pole-first network model (a line is one span between two poles, 3 measurement points per span), CSV import/export, photo evidence, nav pages, light/dark theme | Migration `004`; every old multi-pole line was split into segments |
| Sep to Oct 2026 | apps + backend | refactor | Architecture split: Supabase and Next.js API routes replaced by `backend/` on a VPS; Vercel keeps the frontend | Supersedes `planning/architecture.md`; recorded in the CHANGELOG |
| 2026-10-18 | mobile | feat | Mobile Phase 0: ADR-002, ADR-003, Rust workspace, Capacitor shell, WASM self-test, APK build scripts | Third code folder; supersedes three non-goals in `planning/PROJECT_BRIEF.md` section 4 |
| 2026-10-21 | docs | docs | Mobile UX contract: ADR-006 (Proposed), UI spec, tracking mode, design system, design mock, tasks TASK-010 to TASK-014, this handover | No code changed. Defines what TASK-005 to TASK-011 build |

---

## Review Findings (2026-10-21)

Read-only review of the repository. Ordered by how much they can mislead or hurt.

| # | Finding | Evidence | Where tracked |
|---|---------|----------|---------------|
| 1 | The agent entry points described the old monolith: `PROJECT_CONTEXT`, `PROJECT_MENTAL_MODEL`, `MODULE_MAP`, `CODING_RULES` and `dev-docs/AGENTS.md` still say Next.js monolith, Supabase, `app/api/**`, `lib/data/*`. An agent following them would edit files that no longer exist. | Compare with `apps/` (no `app/api`) | TASK-012. `START_HERE` and this file are already rewritten. |
| 2 | Process docs contradict the repository: "git lives in `apps/`", "root is not a repository", `dev` and `main` branches. Reality: one repo at the root, only `master`. `ai-rules/AGENTS.md` section 0 and the merge procedure assume the old layout. | `git branch`, `CURRENT_STATE` notes | TASK-012. `ai-rules/` is immutable; the contradiction needs a user decision. |
| 3 | Docs say nothing is deployed, but the Vercel site is live. Whether its API is a deployed VPS backend (or a stand-in) is not written anywhere. | `START_HERE` (old), `CURRENT_STATE` | Open question 7 below |
| 4 | The backend sets no security headers (no `helmet`) and has no rate limiting; `ai-rules/AGENTS.md` rule 9 (security standard Parts B and E) asks for both. The photo upload checks only the size (10 MB): the file type and extension come from the client and there is no MIME allow-list, while objects are public-read and served through the same host's `/storage/*` path, so an uploaded HTML or SVG file would likely be served with an active content type from the API's origin (read from the code, not tested). The endpoint sits behind a key that is public by design (finding 5). | `backend/package.json`, `backend/src/app.ts`, `backend/src/routes/uploads.ts`, `backend/src/storage.ts` | TASK-013. Matters more once the app uploads photos from phones. |
| 5 | The shared API key ships in the web bundle (`NEXT_PUBLIC_API_KEY`) and would ship in the APK. Anyone can extract it. | `apps/lib/api.ts` | `TECHNICAL_DEBT`; per-device key in TASK-009 |
| 6 | Survey ingest has no idempotency or transaction and returns HTTP 500 for every error, including an unknown asset id or a disallowed CORS origin. A client retry creates a duplicate survey that skews the aging-rate regression. | `KNOWN_ISSUES` 3 and 4 | TASK-008 |
| 7 | No root `.gitignore` (each folder has its own). A secret file created at the root would not be ignored. | `ls -a` | `TECHNICAL_DEBT` |
| 8 | `apps/` and `backend/` have no automated tests; the insert-only invariant is guarded only by review. | `package.json` | TASK-002 |
| 9 | `mobile-app.md` lists files that do not exist yet (`.env.example`, `config/device-profile.example.json`, `scripts/check-no-secrets.sh`). Harmless but easy to mistake for present. | `ls mobile` | Created in TASK-005 |
| 10 | The provisional severity zones are triplicated (pinned by a golden vector on the Rust side). | `TECHNICAL_DEBT` | Existing entry |

What is in good shape: strict TypeScript and clippy settings on `mobile/`; golden vectors as a cross-target contract; zod validation on every write route; the insert-only rule respected in the survey routes; ADRs written before code; secrets kept out of the repository (device profile gitignored, `.example` files only).

---

## Known Issues at Handover

See `dev-docs/ai/KNOWN_ISSUES.md` for the live list (items 1 to 4 plus the additions of 2026-10-21).

| Area | Issue | Mitigation |
|------|-------|-----------|
| `POST /api/assets/:id/pd-surveys` | No idempotency, no transaction, every error is HTTP 500 | Mobile retries manually only until TASK-008 |
| CORS | `https://localhost` (Capacitor WebView) not yet in the VPS `CORS_ORIGIN` | User action; without it the app's upload fails with a 500 and no CORS headers |
| Mobile | Nothing has run on a phone | TASK-004 spike |
| Mobile protocol | Placeholder; Cantol-side software undecided | Decision gate before TASK-006; ADR-005 |

---

## Decisions Waiting on the User

| # | Decision | Needed by | Detail |
|---|----------|-----------|--------|
| 1 | Accept ADR-006 (Cantol naming, wizard order, line-only scope, tracking mode, tokens) | Before TASK-010 and TASK-005 | `dev-docs/decisions/006-mobile-ux-contract.md` |
| 2 | Where does pulse detection run, Cantol or the phone? | Before TASK-006 | Decides whether WASM and the live phase plot exist |
| 3 | Which statistic is `pd_magnitude` for a recorded window: peak, 95th percentile or other? | Before TASK-007 | Must match what the dashboard's history and aging-rate assume |
| 4 | Approve the mobile light palette | TASK-005 | Proposed in `mobile-design-system.md` |
| 5 | Minimum GPS accuracy to allow a survey (25 m assumed) and tracking thresholds (1.5 dB, 3 dB, 6 dB, 5 s dwell assumed) | TASK-005, TASK-011 | Assumptions flagged in the specs |
| 6 | Does data captured by a real Cantol on real lines count as "real asset data"? | Before TASK-007 | Until answered, upload only to the existing POC dataset |
| 7 | Is the Vercel site talking to a deployed VPS backend? Give the (non-secret) status so `CURRENT_STATE` can be corrected | TASK-012 | Do not paste URLs with keys or IPs into docs |
| 8 | Operator identity: is the sign-in email enough as `surveyor`? | TASK-005 | |
| 9 | Branching: confirm feature branches off `master` and pull requests, since `ai-rules` still mentions `dev` and `main` | Next batch | |
| 10 | Whether a "tracking" flag should become a database field (needs a schema change; `planning/schema.sql` is immutable) | Optional | Today it is only text in `notes` |

---

## What Needs to Happen Next

| Priority | Repo | Task | Blockers |
|----------|------|------|----------|
| P1 | mobile | TASK-004: phone self-test, hotspot and Cantol reachability spike, CORS on the VPS | A phone with USB debugging; the user |
| P1 | mobile + docs | TASK-010: rename Red Pitaya/RP to Cantol in code and living docs | ADR-006 accepted |
| P1 | mobile | TASK-005: scaffold, sign-in, welcome, theme, wizard | TASK-010; spike results for ADR-003 |
| P1 | mobile | TASK-006, TASK-007: live pipeline; capture, tag, upload | Decision gate; CORS; open questions 2, 3, 6 |
| P2 | backend | TASK-008: ingest hardening (ADR-004, migration 005) | Explicit approval to sync `planning/schema.sql` |
| P2 | mobile | TASK-011: tracking mode | TASK-006 and TASK-007 |
| P2 | docs | TASK-012: refresh stale `dev-docs` files | Open questions 7 and 9 |
| P2 | backend | TASK-013: `helmet`, rate limiting | None |
| P2 | mobile | TASK-009: offline queue, foreground service, signing, per-device key | TASK-007, TASK-008 |
| P3 | design | TASK-014: second pass on the mock (units, pickers, states) | None |

---

## Deployment Notes

| Repo | DB Migration | Config Baru | Restart Service | Notes |
|------|-------------|--------------|------------------|-------|
| `apps` | None | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_KEY` in the Vercel project (names only; values are in the user's Vercel settings) | Vercel redeploys on push | Live at the Vercel URL above |
| `backend` | Fresh volume applies `db/init.sql`; existing databases need the numbered files in `planning/migrations/` applied by hand | `backend/.env` (from `.env.example`); `CORS_ORIGIN` must include the web origin and, for the app, `https://localhost` | `docker compose up -d --build`; `docker compose exec api npm run seed` for dummy data | Full steps in `backend/README.md`. Deployment status on the real VPS is unconfirmed. Docker Hub `minio/minio` needs a login, the compose file uses `quay.io/minio/minio` |
| `mobile` | None | Gitignored device profile `mobile/config/device-profile.local.json` (hotspot name and password), local env file for API base URL and key | N/A, sideloaded debug APK | Build: `source mobile/scripts/env.sh`, then `mobile/scripts/android-build.sh`. Release signing is TASK-009 |

---

## Verification Commands

```bash
# apps/ (web)
cd apps && npm ci && npm run lint && npm run build

# backend/
cd backend && npm ci && npm run typecheck && npm run build
docker compose up -d --build            # full stack; first boot applies db/init.sql
docker compose exec api npm run seed    # dummy data, idempotent
curl -k https://localhost/health        # Caddy's self-signed cert locally

# mobile/ (JDK 21 required)
cd mobile && npm ci
source scripts/env.sh                   # per shell; must be sourced, not executed
npm run typecheck && npm run lint && npm test
(cd rust && cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace)
scripts/android-build.sh                # debug APK; add "install" to push to a connected phone
```

Expected at last run (2026-10-18): 42 Rust tests, 6 Vitest tests, APK about 4.2 MB, self-test digest `f7f47846`.

---

## First Hour Checklist for the Next Agent

- ✅ Read `START_HERE.md`, this file, `TASKS.md`
- ✅ Confirm ADR-006 status with the user; if Accepted, flip its status line in the same batch as TASK-010
- ✅ Branch off `master`; one task per branch; report in `reports/task/<area>/`
- ✅ Do not start TASK-006 before decision 2; do not start TASK-007 before decisions 3 and 6
- ✅ Keep this file and `CURRENT_STATE.md` current at the end of every task
