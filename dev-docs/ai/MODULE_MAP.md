# MODULE_MAP

> Living documentation — see `ai-rules/dev-docs-ai-templates/MODULE_MAP-template.md` for the template this was generated from. Business modules match `planning/modules.md`.

---

## Module to Code Map

### Monolith

| Module | Route File | Controllers | Models | Services | Views |
|--------|-----------|-------------|--------|----------|-------|
| Seed Data | — | — | `lib/types.ts` | `scripts/seed.ts` | — |
| Asset Map | `app/page.tsx` | `app/api/assets/route.ts` (GET) | `lib/types.ts` (`Asset`, `AssetListItem`) | `lib/data/assets.ts`, `lib/severity.ts`, `lib/geo.ts` | `components/MapApp.tsx`, `components/map/MapView.tsx`, `AssetMarker.tsx`, `PDPointMarker.tsx`, `LayerToggle.tsx` |
| Asset Detail & History | — | `app/api/assets/[id]/route.ts` (GET) | `lib/types.ts` (`AssetDetail`, `TransformerSurveyEntry`, `LineSurveyEntry`) | `lib/severity.ts` | `components/detail/AssetDetailPanel.tsx`, `SurveyHistoryTimeline.tsx`, `SeverityBadge.tsx` |
| Transformer Survey | — | `app/api/assets/[id]/transformer-surveys/route.ts` (POST) | `lib/types.ts` (`TransformerReading`) | `lib/validation.ts` (`transformerSurveySchema`) | `components/forms/TransformerSurveyForm.tsx` |
| Line PD Survey | — | `app/api/assets/[id]/pd-surveys/route.ts` (POST) | `lib/types.ts` (`PdReading`) | `lib/validation.ts` (`pdSurveySchema`) | `components/forms/LinePdSurveyForm.tsx`, `PointRowInput.tsx` |
| Asset Registry | — | `app/api/assets/route.ts` (POST), `app/api/assets/[id]/route.ts` (PUT) | `lib/types.ts` (`Asset`) | `lib/validation.ts` (`createAssetSchema`, `updateAssetSchema`) | `components/forms/AddAssetForm.tsx` |

There is no separate "Controllers" layer in the traditional MVC sense — the Next.js Route Handler file itself plays that role. There is no ORM/Model class either; `lib/types.ts` holds the shared TypeScript shapes instead.

---

## Shared Infrastructure Map

| Area | Path | Repo | Notes |
|------|------|------|-------|
| DB Client | `lib/supabase.ts` | apps | Single shared client using the anon key (RLS is off — see `planning/architecture.md` §6). No service-role key anywhere in the app. |
| Shared Types | `lib/types.ts` | apps | Mirrors `planning/database.md` table shapes plus the composed API response shapes from `planning/api-contract.md` |
| Validation | `lib/validation.ts` | apps | One zod schema per write endpoint — the only gate between a request body and a database insert |
| Severity Helpers | `lib/severity.ts` | apps | `worstSeverity()` (used by both the list rollup and the detail panel), rank helpers |
| Geo Helpers | `lib/geo.ts` | apps | The one place `[lng,lat]` (storage) is swapped to `[lat,lng]` (Leaflet) — see `planning/PROJECT_BRIEF.md` §2b |
| Auth/Guard | — | apps | None — POC has no authentication (`planning/PROJECT_BRIEF.md` §5 documents the roles planned for later) |
