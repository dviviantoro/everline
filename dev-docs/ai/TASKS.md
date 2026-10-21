# TASKS

> Living documentation — see `ai-rules/dev-docs-ai-templates/TASKS-template.md` for the template this was generated from. Only active tasks belong here; anything Done >1 week moves to `TASKS-ARCHIVE.md`.

---

## Active Tasks

| Priority | ID | Status | Task | Notes |
|----------|----|--------|------|-------|
| P2 | TASK-001 | Todo | Create `dev-docs/architecture/{api-flow,backend-structure,database}.md` | `frontend-structure.md` already exists; these three siblings don't yet. Not required for MVP functionality. |
| P2 | TASK-002 | Todo | Decide on and add automated test coverage (Vitest for `lib/`, Playwright for the 5 core flows) | So far only manual/ad hoc verification exists — no test runner in `package.json` |
| P3 | TASK-003 | Todo | First Vercel deployment + smoke test | Per `planning/timeline.md` Phase 3 — needs a decision on whether to connect a GitHub remote first |
| P1 | TASK-004 | In Progress | Mobile Phase 0: env script, Rust workspace + golden vectors, minimal Capacitor shell with self-test, hotspot/Cantol-reachability spike on real phones, CORS for `https://localhost` | ADR-002, ADR-003, `dev-docs/architecture/mobile-app.md`. **Done (Mac side, 2026-10-18):** `mobile/scripts/env.sh`, Rust workspace with 42 passing tests and 9 golden decode vectors, shell + self-test, debug APK builds (JDK 21); self-test PASS in headless Chromium 153 with digest `f7f47846` equal to the Node run. **Remaining, needs you:** install the APK on a phone and read the self-test (WebView version, `.wasm` MIME, speed), run the hotspot/Cantol-reachability spike on 2-3 phones, add `https://localhost` to the VPS `CORS_ORIGIN`. |
| P1 | TASK-005 | Todo | Mobile Phases 1-2: app scaffold (fonts, tokens, theme, launcher icon), sign-in, welcome animation, then the connection wizard (hotspot, Cantol discover/ping, GPS incl. location permission) | Exit: wizard reaches READY on 3 phones against the Mac `cantol-mock`. Order after sign-in is hotspot, Cantol, GPS (ADR-006). Name things the TASK-010 way from the first line: plugin `CantolLink`, event `cantolFound`, wizard states `CANTOL_*`. Spec: `dev-docs/architecture/mobile-ui-spec.md` sections 1-3.5; design: `mobile-design-system.md` and the mock. Also creates the files `mobile-app.md` lists but that do not exist yet (`.env.example`, `config/device-profile.example.json`, `scripts/check-no-secrets.sh`). Open decisions 4, 5, 8 in FINAL_SYSTEM_HANDOVER. |
| P1 | TASK-006 | Todo | Mobile Phase 3: live pipeline (`cantol-proto/dsp/wasm`, Worker, live PRPD/gauge UI) | Gate: decide where PD detection runs (Cantol or phone) before starting; if Cantol sends final numbers only, drop WASM and the phase plot (keep the numeric tiles). Needs ADR-005 (protocol). Spec: `mobile-ui-spec.md` section 3.6. |
| P1 | TASK-007 | Todo | Mobile Phase 4: capture, tag and online-only upload of a PD survey | Needs the CORS change deployed on the VPS. Tag form, asset and measurement-point pickers and the upload sequence: `mobile-ui-spec.md` sections 3.8, 3.9 and 5. Blocked on decisions 3 (which statistic is `pd_magnitude`) and 6 (real vs POC data). |
| P2 | TASK-008 | Todo | Backend ingest hardening for the mobile app (migration 005, idempotency via `client_survey_id`, transaction, honest status codes) | ADR-004 to be written; schema sync of `planning/schema.sql` needs explicit approval |
| P2 | TASK-009 | Todo | Mobile Phase 5: offline queue, foreground service, release signing, sideload/Play checklist, per-device key | Needs TASK-008 first (a retry must not duplicate surveys). Adds the queue states and "Sync now" to the Surveys screen. |
| P2 | TASK-011 | Todo | Mobile tracking mode: setup and live screens, trend rules in `cantol-dsp` with golden vectors, save as one survey | `dev-docs/architecture/mobile-tracking-mode.md`. After TASK-006 and TASK-007. Thresholds (1.5 dB, 3 dB, 6 dB, 5 s dwell) are assumptions; flag them. No API or schema change. |
| P2 | TASK-012 | Todo | Refresh the stale `dev-docs` files for the three-folder repo: `PROJECT_CONTEXT`, `PROJECT_MENTAL_MODEL`, `MODULE_MAP`, `CODING_RULES`, `dev-docs/AGENTS.md`, the first two Priority Debt rows and the Risky Areas rows in `TECHNICAL_DEBT`, the Snapshot table and the old git-layout bullets in `CURRENT_STATE` | They still describe the Next.js + Supabase monolith. `START_HERE` and `FINAL_SYSTEM_HANDOVER` were rewritten 2026-10-21. Needs decisions 7 (deployment status) and 9 (branching). Do not edit `ai-rules/` (it also assumes the old layout; raise with the user). Also propose the `apps/README.md`, `backend/README.md` and a new `mobile/README.md` per `ai-rules/AGENTS.md` rule 8 (drafts for approval). |
| P2 | TASK-013 | Todo | Backend hardening per `ai-rules/security`: security headers (`helmet`), rate limiting, MIME allow-list and extension from the type on `POST /api/uploads` | Review finding 4. Test with curl: oversize, wrong type, burst of requests. Does not remove the shared-key weakness (that is TASK-009). |
| P3 | TASK-014 | Todo | Second pass on the design mock: dBmV units, asset and measurement-point pickers, optional photo/temperature rows, manual IP and diagnostics, permission and link-lost states, settings, check at 360x640 and large fonts | `dev-docs/architecture/mobile-ui-spec.md` section 6. First check text overflow after the font change. Update the spec in the same batch. |
| P1 | TASK-015 | In Progress | Mobile demo build: every screen of the mock with the real behaviour of `mobile-ui-spec.md`, fed by a simulated Cantol, hotspot, GPS and survey API behind interfaces, as an installable debug APK (`npm run build:demo`, `scripts/android-build.sh demo`) | ADR-007. Branch `feat/mobile-demo-apk`. Never uploads and never networks; a normal build is unchanged. It builds the UI of TASK-005, 006, 007 and 011 against simulated sources; the real `HotspotAssistant`, `CantolLink`, `Gnss`, the upload, the photo and the VPS CORS change stay with those tasks. |

---

## Recently Done (<1 week)

| ID | Task | Completion Date | Notes |
|----|------|----------------|-------|
| TASK-000 | Scaffold `apps/` (Next.js App Router monolith); build seed data, map, asset detail panel + history, transformer survey form, line PD survey form, add-asset form; all API routes | 2026-09-05 | Verified end-to-end against a live Supabase project |
| TASK-000b | Fix `transformer_readings` PostgREST embed-shape bug and map click z-order bug found during live testing | 2026-09-05 | Both confirmed fixed via re-test |
| TASK-000c | Fill `planning/modules.md`, `planning/timeline.md`, and all `dev-docs/ai/*` files | 2026-09-05 | This session |
| TASK-010 | Rename Red Pitaya / RP to Cantol in `mobile/` code and living docs | 2026-10-21 | `rp-mock` is now `cantol-mock`; comments, strings and UI text under `mobile/rust` and `mobile/src` say Cantol. `RpLink`, `rpFound` and `RP_*` never existed in code, so only the docs were fixed; new code uses `CantolLink`, `cantolFound`, `CANTOL_*`. No behaviour change: digest `f7f47846` unchanged, 42 Rust and 6 Vitest tests pass, debug APK builds. Kept on purpose: device-id strings `RP-00A1` (inside a golden vector), `RP-MOCK`, `RP-01`. Report: `reports/task/mobile/2026-10-21-task-010-cantol-rename.md`. |

---

## Inferred Next Tasks (from Repository Analysis)

| Priority | Task | Reason |
|----------|------|--------|
| P1 | Add a regression test (or at minimum a manual UAT checklist item) asserting a new survey never mutates a prior `surveys`/`transformer_readings`/`pd_readings` row | This is the single most important invariant in the app and is currently enforced only by code review discipline, not a test — see `dev-docs/ai/PROJECT_MENTAL_MODEL.md` §5 |
| P2 | Enable Supabase Row Level Security with real policies | Required before any real (non-dummy) asset data is stored — `planning/architecture.md` §6 |
| P3 | Require at least one route point when registering a line via `AddAssetForm` | Currently unvalidated client- and server-side, unlike the PD survey form which requires ≥1 point — see `dev-docs/ai/KNOWN_ISSUES.md` |

---

## Definition of Done for Current Milestone

- Map renders all seeded transformers + lines with correct severity colors
- Clicking any asset opens its detail panel with full, chronologically-ordered survey history
- Both survey forms and the add-asset form each successfully write to Supabase without altering prior survey/reading rows
- `npm run lint` and `npm run build` both pass

**Milestone:** M3 — History & Surveys (`planning/timeline.md`) — all criteria above are met as of 2026-09-05.

---

## Archive

Nothing archived yet. See [TASKS-ARCHIVE.md](./TASKS-ARCHIVE.md) once tasks above age past one week.
