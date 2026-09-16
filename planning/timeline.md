# Timeline & Milestones — PLN 20kV Asset Monitoring (POC)

> **Planning blueprint — treat as reference, not something to edit ad hoc.** Generated from `ai-rules/planning-templates/timeline.md`.
>
> Per `planning/PROJECT_BRIEF.md` §14, target dates, budget, and team size are **not yet set** — this is an internal-demo POC, not a dated release. Milestones below are ordered by dependency (per `planning/modules.md` §4), not calendar date. Dates should be filled in once a real target exists; until then treat every `Target Date` as **TBD**.

---

## Project Type Declaration

| Item | Value |
|------|-------|
| Project Type | Monolith |
| Repo | `apps/` |

---

## 1. Milestone Overview

| Milestone | Target Date | Status | Deliverables |
|-----------|-------------|--------|--------------|
| M1 — Foundation | TBD | In Progress | `apps/` scaffolded (Next.js + Tailwind + Supabase client), git initialized, schema applied to Supabase |
| M2 — Map + Seed Data | TBD | Planned | Dummy transformers/lines seeded, map renders them with severity colors + layer toggle |
| M3 — History & Surveys | TBD | Planned | Asset detail panel + history timeline, transformer survey form, line PD survey form all working end-to-end |
| M4 — Registry & Polish | TBD | Planned | Add-asset form; UAT pass on insert-only guarantee; deploy to Vercel |

---

## 2. Phase Breakdown

### Phase 1: Foundation

| Task | Repo | Dependencies |
|------|------|---------------|
| Scaffold `apps/` (Next.js App Router, Tailwind, `react-leaflet`, `@supabase/supabase-js`) | apps | — |
| `git init` in `apps/`, first commit on a `dev` branch | apps | Scaffold |
| Supabase project: run `schema.sql`, capture URL + anon key into `apps/.env.local` | apps | — |
| `lib/supabase.ts` client + `lib/types.ts` shared types matching `planning/database.md` | apps | Supabase project ready |

### Phase 2: Core Features

| Task | Repo | Dependencies |
|------|------|---------------|
| Seed script: ~10–20 dummy assets + 2–3 historical surveys each, one Central Java service area | apps | Phase 1 |
| `MapView` + `AssetMarker`/`PDPointMarker` + `LayerToggle` | apps | Seed script |
| `GET /api/assets`, `GET /api/assets/{id}` | apps | Seed script |
| `AssetDetailPanel` + `SurveyHistoryTimeline` + `SeverityBadge` | apps | Map view working |
| `TransformerSurveyForm` + `POST /api/assets/{id}/transformer-surveys` | apps | Detail panel |
| `LinePdSurveyForm` + `PointRowInput` + `POST /api/assets/{id}/pd-surveys` | apps | Detail panel |
| `AddAssetForm` + `POST /api/assets` | apps | Map view working |

### Phase 3: Polish & Launch

| Task | Repo | Dependencies |
|------|------|---------------|
| UAT: confirm a submitted survey never mutates prior `surveys`/`transformer_readings`/`pd_readings` rows | apps | All Phase 2 modules |
| Responsive pass (mobile-first forms, side-drawer vs. bottom-sheet detail panel) | apps | All Phase 2 modules |
| Deploy to Vercel (free/Hobby tier), smoke test against Supabase free tier | apps | UAT passed |

---

## 3. Release Plan

| Version | Date | Repo | Scope |
|---------|------|------|-------|
| `v0.1.0` (Internal demo) | TBD | apps | Map + seed data render correctly (M2) |
| `v0.2.0` (Internal demo) | TBD | apps | Full survey write path + history timeline (M3) |
| `v0.3.0` (POC complete) | TBD | apps | Asset registry + deployed on Vercel (M4) |

No `v1.0.0` / production milestone yet — out of scope until real PLN data integration is greenlit (`planning/prd.md` §3 Post-MVP item 5).

---

## 4. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Severity thresholds (PD magnitude, load %, temp) still undefined (`PROJECT_BRIEF.md` §16) | High | Med | Use clearly-flagged placeholder thresholds in seed data/validation; revisit with PLN maintenance standards before this leaves POC stage |
| Accidental UPDATE/DELETE against `surveys`/`transformer_readings`/`pd_readings` | Low | High | Insert-only enforced at the API-route level; UAT explicitly checks history is preserved after every survey submission |
| Supabase free tier / RLS left off | Low | Med | Acceptable for dummy data per `architecture.md` §6; must not carry into any phase with real asset data |
| GeoJSON `[lng,lat]` vs. Leaflet `(lat,lng)` order mismatch | Med | Med | Centralize the coordinate swap in one mapping-layer helper, not scattered across components |
