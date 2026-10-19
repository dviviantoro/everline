# TASKS

> Living documentation — see `ai-rules/dev-docs-ai-templates/TASKS-template.md` for the template this was generated from. Only active tasks belong here; anything Done >1 week moves to `TASKS-ARCHIVE.md`.

---

## Active Tasks

| Priority | ID | Status | Task | Notes |
|----------|----|--------|------|-------|
| P2 | TASK-001 | Todo | Create `dev-docs/architecture/{api-flow,backend-structure,database}.md` | `frontend-structure.md` already exists; these three siblings don't yet. Not required for MVP functionality. |
| P2 | TASK-002 | Todo | Decide on and add automated test coverage (Vitest for `lib/`, Playwright for the 5 core flows) | So far only manual/ad hoc verification exists — no test runner in `package.json` |
| P3 | TASK-003 | Todo | First Vercel deployment + smoke test | Per `planning/timeline.md` Phase 3 — needs a decision on whether to connect a GitHub remote first |
| P1 | TASK-004 | In Progress | Mobile Phase 0: env script, Rust workspace + golden vectors, minimal Capacitor shell with self-test, hotspot/RP-reachability spike on real phones, CORS for `https://localhost` | ADR-002, ADR-003, `dev-docs/architecture/mobile-app.md`. **Done (Mac side, 2026-10-18):** `mobile/scripts/env.sh`, Rust workspace with 42 passing tests and 9 golden decode vectors, shell + self-test, debug APK builds (JDK 21); self-test PASS in headless Chromium 153 with digest `f7f47846` equal to the Node run. **Remaining, needs you:** install the APK on a phone and read the self-test (WebView version, `.wasm` MIME, speed), run the hotspot/RP-reachability spike on 2-3 phones, add `https://localhost` to the VPS `CORS_ORIGIN`. |
| P1 | TASK-005 | Todo | Mobile Phases 1-2: app scaffold, then the connection wizard (permissions, hotspot, discover/ping, GPS) | Exit: wizard reaches READY on 3 phones against the Mac `rp-mock` |
| P1 | TASK-006 | Todo | Mobile Phase 3: live pipeline (`cantol-proto/dsp/wasm`, Worker, live PRPD/gauge UI) | Gate: decide where PD detection runs (RP or phone) before starting; if the RP sends final numbers only, drop WASM |
| P1 | TASK-007 | Todo | Mobile Phase 4: capture and online-only upload of a PD survey | Needs CORS change deployed on the VPS |
| P2 | TASK-008 | Todo | Backend ingest hardening for the mobile app (migration 005, idempotency via `client_survey_id`, transaction, honest status codes) | ADR-004 to be written; schema sync of `planning/schema.sql` needs explicit approval |
| P2 | TASK-009 | Todo | Mobile Phase 5: offline queue, foreground service, release signing, sideload/Play checklist, per-device key | |

---

## Recently Done (<1 week)

| ID | Task | Completion Date | Notes |
|----|------|----------------|-------|
| TASK-000 | Scaffold `apps/` (Next.js App Router monolith); build seed data, map, asset detail panel + history, transformer survey form, line PD survey form, add-asset form; all API routes | 2026-09-05 | Verified end-to-end against a live Supabase project |
| TASK-000b | Fix `transformer_readings` PostgREST embed-shape bug and map click z-order bug found during live testing | 2026-09-05 | Both confirmed fixed via re-test |
| TASK-000c | Fill `planning/modules.md`, `planning/timeline.md`, and all `dev-docs/ai/*` files | 2026-09-05 | This session |

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
