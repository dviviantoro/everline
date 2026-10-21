# CURRENT_STATE

> Living documentation — see `ai-rules/dev-docs-ai-templates/CURRENT_STATE-template.md` for the template this was generated from. Update at the end of every task.

---

## Snapshot

| Repo | Branch | Last Commit | Notes |
|------|--------|------------|-------|
| `apps` | `dev` | `364cf2d` (uncommitted changes on top — several rounds since) | Frontend only as of this round — all server-side DB/API logic removed, everything now goes through `lib/api.ts` to the external backend |
| `backend` | (new, uncommitted) | — | New separate git repo, Express + Postgres + MinIO + Caddy, Dockerized. Built and verified end-to-end locally in the dev sandbox (not yet deployed to the user's actual VPS) |
| `mobile` | `master` | `d6e4411` | Android field-capture app (Capacitor 8 + Rust/WASM), Phase 0 in progress: Rust workspace, golden vectors, shell with a WASM self-test, debug APK builds. Not yet run on a phone. See ADR-002/003 and `dev-docs/architecture/mobile-app.md`. |

> Note on the repo layout: the rows above were written for the earlier two-repo layout. Today there is one git repository at the project root (`master`, remote `origin`) containing `apps/`, `backend/`, `mobile/`, `dev-docs/`, `planning/` and `ai-rules/`; the commit hashes in the older rows no longer exist in it.

| Last Updated | 2026-10-21 (docs-only handoff batch on top of `dd95242`; see `FINAL_SYSTEM_HANDOVER.md`) |
| Updated By | Claude Sonnet 5.5 |

---

## Recent Development Highlights

| Repo | Commit | Date | Summary |
|------|--------|------|---------|
| `apps` | `48d30a9` | 2026-09-05 | Initial commit from `create-next-app` (App Router, TypeScript, Tailwind) |
| `apps` | `344f240` | 2026-09-05 | Scaffolded map, asset detail panel, both survey forms, add-asset form, all API routes, seed script |
| `apps` | `22bab10` | 2026-09-05 | Fixed `transformer_readings` PostgREST embed shape bug and forced dynamic rendering on `/` |
| `apps` | `ef90449` | 2026-09-05 | Fixed map click z-order — lines rendered after markers were intercepting clicks meant for nearby transformers |
| `apps` | `8e4c760` | 2026-09-05 | Added `apps/README.md` onboarding guide |
| `apps` | `d08f6c0` | 2026-09-05 | Fixed dev server being unreachable over a forwarded/LAN origin (`allowedDevOrigins`) |
| `apps` | `2c3fd90` | 2026-09-05 | Added landing page (`/`) and login screen (`/login`); moved map to `/dashboard`; rebranded as GARDU |
| `apps` | `3b1ebdf` | 2026-09-05 | Patched upstream Leaflet `_leaflet_pos` crash via `patch-package` |
| `apps` | `666f536` | 2026-09-05 | Relocated seed data from Semarang to Pekalongan; added a 5th line |
| `apps` | `6c7d6db` | 2026-09-06 | Added nameplate fields, `transformer_telemetry` (simulated IoT, ~5-min interval), and `poles` as a first-class entity with PD history graphs |
| `apps` | `364cf2d` | 2026-09-06 | Added collapsible left sidebar, renamed app to EverLine, wire.png app icon |

---

## Module Maturity (Practical State)

| Module | Repo | State | Notes |
|--------|------|-------|-------|
| Seed Data | apps | Beta | 8 transformers + 5 lines in Pekalongan, idempotent re-run (`npm run seed`) |
| Asset Map | apps | Beta | Verified rendering + severity colors; map click z-order bug and `_leaflet_pos` crash both found and fixed |
| Asset Detail & History | apps | Beta | Verified — expandable history, correct worst-severity rollup for lines |
| Transformer Survey | apps | Beta | Verified end-to-end (submit → marker updates → history preserved) |
| Line PD Survey | apps | Beta | Verified end-to-end, including multi-point patrol submission |
| Asset Registry | apps | Beta | Verified — new asset renders with "no data yet" gray marker |
| Landing Page | apps | Beta | Server component, live asset stats from Supabase |
| Login | apps | Beta | UI-only sign-in gate — no auth backend (`planning/PROJECT_BRIEF.md` §4) |
| Nameplate & Telemetry | apps | Beta | Verified — nameplate/telemetry/survey-history are independently collapsible sections; telemetry shows the transformer's lat/lng |
| Poles & Measurement Points | apps + backend | Beta | Poles are standalone network nodes (no owning line) shown as plain gray diamonds; a line is exactly one span between 2 poles; `measurement_points` (3 per span) carry the actual PD/device/photo history, shown as severity-colored squares — verified locally against the Dockerized backend (seed data + live API calls) |
| CSV Import/Export | apps + backend | Beta | Bulk import for poles/transformers/lines via `CsvImportForm` → `POST /api/import/*` — verified locally with curl (pole import round-trip). Export ("Export CSV" button) on telemetry + PD measurement history — client-side only, unaffected by the backend split |
| Photo Evidence | apps + backend | Beta | Upload → backend `POST /api/uploads` → MinIO (`pd-photos` bucket, public-read policy set automatically on backend startup) → public URL. Verified locally: uploaded a test file via curl, then fetched it back through Caddy's `/storage/*` proxy and got the same bytes back |
| Dashboard Sidebar & Nav | apps | Beta | Layer toggles (Transformers/Lines/Poles/PD Measurement), legend, Add Asset, amber-tinted `wire.png` logo, plus Asset Registry/Reports/Settings/Profile/Logout nav items and a light/dark theme toggle |
| Backend / API Split | backend | Beta | New Express + `pg` + MinIO + Caddy stack in `backend/`, replacing Supabase entirely — see `backend/README.md`. Verified locally end-to-end (build, `docker compose up`, seed, curl smoke tests covering auth/CRUD/import/upload, Swagger docs) via Docker in the dev sandbox. **Not yet deployed to the user's real VPS** — that's the user's next step |
| Auth / RBAC | apps + backend | Planned | Still deferred per `planning/PROJECT_BRIEF.md` §5. The backend's `X-API-Key` header is a minimal shared-secret safeguard, explicitly not real auth |
| Mobile Rust workspace | mobile | Alpha | `cantol-proto` (placeholder Cantol protocol: frame codec, CRC32, resyncing decoder), `cantol-dsp` (severity zones only for now), `cantol-wasm` (27 KB facade), `cantol-mock` (simulated Cantol device with fault injection). 42 native tests; 9 golden decode vectors plus classification vectors replayed in Node and in Chromium 153 with identical digest `f7f47846`. Not yet verified inside the Capacitor WebView on a phone. |
| Mobile app shell | mobile | Alpha | Vite + React + Tailwind 4 + Capacitor 8; one screen (WASM self-test). Debug APK builds with JDK 21 (4.2 MB, `allowBackup` off, INTERNET only). No wizard, hotspot handling, GPS or upload yet (TASK-005 to TASK-009). |
| Mobile UX contract and design mock | mobile + docs | Designed (not built) | 2026-10-21: ADR-006 (Accepted 2026-10-21; TASK-010 Cantol rename done), `mobile-ui-spec.md`, `mobile-tracking-mode.md`, `mobile-design-system.md`, 11-screen mock in `dev-docs/design/mobile/mock/`. The mock was checked against the repo's tokens and fonts but not visually re-checked after the font change, and its numbers are in mV (the real unit is dBmV; see the spec's table). Tasks TASK-010 to TASK-014. |

---

## Active Backlog (Non-Done Tasks)

See `dev-docs/ai/TASKS.md` for the live list.

---

## Test / QA State

| Repo | Area | Coverage | Status |
|------|------|----------|--------|
| `apps` | `lint` (eslint) | — | Passing |
| `apps` | `build` (next build + tsc) | — | Passing |
| `apps` | manual E2E (ad hoc Playwright, not committed) | all 7 modules + login flow + console-error checks | Passing (last run 2026-09-05) |
| `apps` | automated test suite | 0% | Not Run — none exists yet |
| `mobile` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace` | 42 tests: protocol codec, decoder, golden vectors (9 streams x 11 chunkings), severity, Cantol mock end-to-end over loopback sockets | Passing (2026-10-21, after the TASK-010 rename) |
| `mobile` | `npm run typecheck`, `npm run lint`, `npm test` (Vitest) | 6 tests: vectors through the real WASM in Node, negative controls, throughput, FNV-1a | Passing (2026-10-18) |
| `mobile` | `npm run build`, `scripts/android-build.sh` | production bundle 292 KB; debug APK 4.2 MB | Passing (2026-10-18) |
| `mobile` | self-test in a real browser | headless Chromium 153: PASS, 0.32 ms per 64 KiB, `.wasm` served as `application/wasm` | Passing (2026-10-18). **Not yet run in an Android WebView.** |

---

## Important Nuance

- **Read this first (2026-10-21):** several bullets in this section were written before the backend split and before the single-repository layout and are superseded: the Supabase and `lib/data/assets.ts` notes, the "git lives in `apps/` and `backend/`" bullet, "Root of this repository is intentionally not a git repository" and "Contradiction found in the framework itself". The current layout is one git repository at the project root (`master`). `FINAL_SYSTEM_HANDOVER.md` is the up-to-date summary; TASK-012 cleans this file properly. Deployment status of the VPS backend is unconfirmed (the Vercel frontend is live).
- **Pending user action: deploy `backend/` to the real VPS.** Everything backend-related was built and verified against a local Docker Compose stack in the dev sandbox (self-signed `localhost` cert), not the user's actual server. Next steps for them: provision the VPS (Docker + Compose), point DNS at it, fill in `backend/.env` from `.env.example`, `docker compose up -d --build`, `docker compose exec api npm run seed`, then set `NEXT_PUBLIC_API_BASE_URL`/`NEXT_PUBLIC_API_KEY` in the Vercel project. Full steps in `backend/README.md`.
- Docker Hub's `minio/minio` image now requires a login for anonymous pulls (discovered while testing this round) — `docker-compose.yml` uses `quay.io/minio/minio` instead, MinIO's other official, still-public registry.
- `planning/architecture.md` is marked immutable and was **not** edited to reflect the backend split — it documents the original Monolith-on-Vercel-with-Supabase decision. This CHANGELOG/CURRENT_STATE pair is the source of truth for what's actually true now; treat `architecture.md` as historical intent, not current state, until/unless the user asks for it to be rewritten.
- CSV export is CSV only, not a true binary `.xlsx` — deliberate, to avoid a heavy new dependency for a POC need that Excel opens fine either way.
- A transformer's optional "use pole location" picker (`AddAssetForm`) is a client-side lat/lng autofill convenience only — transformers are not FK-linked to a pole, since a gardu is physically distinct from a tiang.
- `transformer_telemetry` is entirely synthetic (`backend/scripts/seed.ts` `seedTelemetry()`) — no real IoT device is connected. `POST /api/assets/{id}/telemetry` is architecturally ready to accept real device pushes but only has the shared API-key safeguard, not real device auth; that must change before any real device or real data goes near it.
- "dmd" was interpreted as demand in kVA (`demand_kva` column) — an assumption, not confirmed against a real meter's actual field naming.

- Assumption based on repository analysis: severity/condition values are always operator-entered; nothing in the app computes them from a threshold at runtime. The load%/PD-magnitude cutoffs in `backend/scripts/seed.ts` only shape plausible-looking dummy data and are explicitly commented as not a production rule (`planning/PROJECT_BRIEF.md` §16).
- `leaflet` is patched via `patch-package` (`apps/patches/leaflet+1.9.4.patch`) for an upstream `_leaflet_pos` crash (Leaflet/Leaflet#9527) — the fix exists in Leaflet's source but was never released to npm (1.9.4 is still `latest`). Drop the patch once a release newer than 1.9.4 ships with it.
- `allowedDevOrigins` in `apps/next.config.ts` computes the machine's current LAN IPs at server startup (`os.networkInterfaces()`) instead of a hardcoded address — a hardcoded IP already went stale once (network change), silently re-triggering the "map stuck forever on 'Loading map…', zero console errors" bug, since the map is client-only (`ssr:false`) with no server-rendered fallback to reveal anything was wrong. Unrelated to the backend split (this affects reaching the Next.js dev server itself, not the API).
- **Superseded:** the two bullets about git living in `apps/` and `backend/` (and about the project root not being a repository) describe an earlier state. The project root is now one git repository on `master` that tracks `apps/`, `backend/`, `mobile/`, `dev-docs/`, `planning/` and `ai-rules/`.
- **Mobile app (2026-10-18):** `mobile/` was added under ADR-002 and ADR-003, which override `planning/PROJECT_BRIEF.md` §4 (native mobile app, live telemetry, offline capture as non-goals). `planning/*` was left untouched. Android has no public API to turn on the tethering hotspot or set its SSID/password, so v1 is a guided one-time hotspot setup plus one toggle per session. The Cantol protocol is a placeholder and the Cantol-side software is undecided; whether WASM stays depends on whether Cantol or the phone does pulse detection (decision gate before TASK-006).
- **Pending user actions for the mobile app:** plug in a phone with USB debugging; add `https://localhost` to `CORS_ORIGIN` in the VPS `backend/.env` and run `docker compose up -d` (the Capacitor WebView origin; an origin missing from the list gets an HTTP 500 with no CORS headers); choose the hotspot SSID/password (kept only in gitignored local files).
- Open question for the user, not decided: the planning docs say "dummy data only, no real PLN asset data in this phase". Whether data captured by a real Cantol on real lines counts as real asset data is unanswered; until it is, the app should only upload to the existing POC dataset.
- Root of this repository is intentionally not a git repository. Git now lives in **two** places: `apps/` (frontend) and the new `backend/` (API/DB/storage) — this activates the framework's "Fullstack" project-type convention (`ai-rules/AGENTS.md` §0), which was defined but unused until this round.
- **Contradiction found in the framework itself:** `ai-rules/AGENTS.md` §0/§0a forbid `git init` at the project root, yet §5's merge procedure runs `git restore ... ../ai-rules ../dev-docs ../planning ...` relative to the `apps/` repo — paths outside any repo rooted at `apps/` can never be tracked by it. Practical effect right now: `planning/`, `dev-docs/`, and `ai-rules/` at the project root have **no version control at all** — confirmed by running `git ls-files --error-unmatch ../dev-docs` from inside `apps/`, which fails because that path is outside the repository. Flagged to the user this session; unresolved as of this writing.
