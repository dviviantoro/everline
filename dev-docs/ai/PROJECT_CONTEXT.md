# PROJECT_CONTEXT

> Living documentation — see `ai-rules/dev-docs-ai-templates/PROJECT_CONTEXT-template.md` for the template this was generated from.

---

## System Overview

A map-based POC for PLN's 20kV distribution network in Central Java. It shows every transformer and power line on a map and tracks their condition over time through field surveys: electrical readings on transformers, partial-discharge and temperature readings along lines. Users are Field Operators (submit surveys from the field) and Asset Engineers (review the map and per-asset history to prioritize maintenance). The goal is to prove that historical, location-anchored survey data gives clear at-a-glance visibility into asset health — before any connection to PLN's real production systems.

---

## Project Type Declaration

| Item | Value |
|------|-------|
| Project Type | Monolith |
| Git Location | `apps/` — single repo (root itself is not a git repository) |

---

## Runtime Stack

| Layer | Technology |
|-------|-----------|
| Backend | Next.js API Route Handlers (App Router), bundled with the frontend |
| Frontend | Next.js (React 19, App Router), hybrid server/client rendering |
| Database Primary | PostgreSQL via Supabase |
| Cache | none |
| Queue | none |
| Search | none |
| Storage | none (POC — no photo/thermal-image attachments yet) |
| Web Server | Vercel (managed, Git-integrated deploy) — not yet deployed as of this writing |

---

## UI/UX Template & Framework

| Item | Value |
|------|-------|
| Template HTML Provided? | TIDAK |
| Template Name | N/A |
| UI Framework | Tailwind CSS |
| Framework Version | latest stable (v4, via `@tailwindcss/postcss`) |

Map rendering uses `react-leaflet` + `leaflet` with OpenStreetMap tiles (no API key). No chart library yet — `recharts` is the intended choice if a trend chart is added later (not needed for MVP).

---

## Database Topology

| Connection | Domain / Schema | Notes |
|-----------|----------------|-------|
| default (Supabase project, public schema) | `assets`, `surveys`, `transformer_readings`, `pd_readings` | Single Postgres database. `surveys`/`transformer_readings`/`pd_readings` are insert-only — see `planning/architecture.md` §8. RLS is off (dummy data only) — see `schema.sql` note. |

---

## Source Structure (Important)

| Path | Function |
|------|----------|
| `apps/app/page.tsx` | Map screen entry point (server component, fetches initial asset list) |
| `apps/app/api/` | Route Handlers — assets registry + survey write paths |
| `apps/components/map/` | `MapView`, `AssetMarker`, `PDPointMarker`, `LayerToggle` |
| `apps/components/detail/` | `AssetDetailPanel`, `SurveyHistoryTimeline`, `SeverityBadge` |
| `apps/components/forms/` | `TransformerSurveyForm`, `LinePdSurveyForm`, `PointRowInput`, `AddAssetForm`, `GpsCaptureButton` |
| `apps/components/MapApp.tsx` | Client-side state container (selection, layer toggle, forms) |
| `apps/lib/` | Supabase client, shared types, zod validation, severity/geo helpers, shared list-query logic |
| `apps/scripts/seed.ts` | Idempotent dummy data seeder (run via `npm run seed`) |

---

## Current Architecture Direction

Plain layered monolith — one Next.js app, one Postgres database, no microservices, no separate service/repository layer (API routes call Supabase directly; see `dev-docs/ai/TECHNICAL_DEBT.md` for the accepted tradeoff this implies at POC scale). Not in transition — this is the intended shape for the whole POC phase per `planning/architecture.md` §2 ("kept deliberately simple").

---

## Uncertainty Markers

- Assumption based on repository analysis: severity/condition classification (`good`/`warning`/`critical`, `normal`/`warning`/`critical`) is entirely operator-entered in the real app; the thresholds used in `scripts/seed.ts` to pick plausible-looking synthetic values are not a production rule — see `planning/PROJECT_BRIEF.md` §16.
- Assumption based on repository analysis: no automated test suite exists yet — all verification so far has been manual (`npm run lint`, `npm run build`, and ad hoc Playwright scripts run against a live dev server, not committed to the repo).
