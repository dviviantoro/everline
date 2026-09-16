# TASKS

> Living documentation — see `ai-rules/dev-docs-ai-templates/TASKS-template.md` for the template this was generated from. Only active tasks belong here; anything Done >1 week moves to `TASKS-ARCHIVE.md`.

---

## Active Tasks

| Priority | ID | Status | Task | Notes |
|----------|----|--------|------|-------|
| P2 | TASK-001 | Todo | Create `dev-docs/architecture/{api-flow,backend-structure,database}.md` | `frontend-structure.md` already exists; these three siblings don't yet. Not required for MVP functionality. |
| P2 | TASK-002 | Todo | Decide on and add automated test coverage (Vitest for `lib/`, Playwright for the 5 core flows) | So far only manual/ad hoc verification exists — no test runner in `package.json` |
| P3 | TASK-003 | Todo | First Vercel deployment + smoke test | Per `planning/timeline.md` Phase 3 — needs a decision on whether to connect a GitHub remote first |

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
