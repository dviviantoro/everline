# Module Breakdown — PLN 20kV Asset Monitoring (POC)

> **Planning blueprint — treat as reference, not something to edit ad hoc.** Generated from `ai-rules/planning-templates/modules.md` using `planning/PROJECT_BRIEF.md`, `planning/prd.md`, and `planning/architecture.md` as source.

---

## Project Type Declaration

| Item | Value |
|------|-------|
| Project Type | Monolith |
| Repo | `apps/` (single Next.js app — no backend/frontend split) |

---

## 1. Module Map

| # | Module | Deskripsi | Repo | Priority | Dependencies |
|---|--------|-----------|------|----------|---------------|
| 1 | Seed Data | Dummy transformers + lines + historical surveys, clustered in one Central Java service area | apps | P0 | — |
| 2 | Asset Map | Map view rendering transformer markers + line polylines, severity colors, layer toggle | apps | P0 | Seed Data |
| 3 | Asset Detail & History | Detail panel showing latest reading + full survey history timeline | apps | P0 | Asset Map |
| 4 | Transformer Survey | Form to submit a transformer electrical reading (insert-only) | apps | P0 | Asset Detail & History |
| 5 | Line PD Survey | Form to submit a multi-point PD/temperature patrol as one survey (insert-only) | apps | P0 | Asset Detail & History |
| 6 | Asset Registry | Add-asset form to register a new transformer or line before any survey exists | apps | P1 | Asset Map |

**Priority:** P0 = MVP wajib, P1 = penting, P2 = nice to have

---

## 2. Module Detail

### 1. Seed Data

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | none (build-time/one-off script + optional `app/api/dev/seed` route, dev-only) |
| Middleware | none |
| User Roles | none (POC has no auth) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| Seed script inserting `assets`, `surveys`, `transformer_readings`, `pd_readings` rows via the Supabase client | `Asset`, `Survey`, `TransformerReading`, `PdReading` types (`lib/types.ts`) | Supabase client (`lib/supabase.ts`) |

**External Dependencies:**
- `@supabase/supabase-js`

---

### 2. Asset Map

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | `/` (page), `/api/assets` (data) |
| Middleware | none |
| User Roles | Asset Engineer, Field Operator (both read) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| `GET /api/assets` list with optional `?type=` filter, rollup of `latest_condition`/`latest_severity` | `Asset` | Supabase `select` on `assets` joined to latest `surveys` |

**Frontend:**

| Key Pages | Key Components |
|-----------|-----------------|
| `app/page.tsx` — map screen | `MapView`, `AssetMarker`, `PDPointMarker`, `LayerToggle` |

**External Dependencies:**
- `react-leaflet`, `leaflet` (OpenStreetMap tiles, no API key)

---

### 3. Asset Detail & History

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | `/api/assets/{id}` |
| Middleware | none |
| User Roles | Asset Engineer, Field Operator (both read) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| `GET /api/assets/{id}` with full `surveys` history + nested reading/points | `Asset`, `Survey`, `TransformerReading`, `PdReading` | Supabase joined query, ordered by `surveyed_at desc` |

**Frontend:**

| Key Pages | Key Components |
|-----------|-----------------|
| Overlay panel opened from `app/page.tsx` (not a separate route) | `AssetDetailPanel`, `SurveyHistoryTimeline`, `SeverityBadge` |

---

### 4. Transformer Survey

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | `/api/assets/{id}/transformer-surveys` |
| Middleware | none |
| User Roles | Field Operator (write) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| `POST` insert-only — one `surveys` row + one `transformer_readings` row per submit. **Never UPDATE/DELETE.** | `Survey`, `TransformerReading` | Input validation (Zod) before insert |

**Frontend:**

| Key Pages | Key Components |
|-----------|-----------------|
| Form opened from Asset Detail Panel | `TransformerSurveyForm`, `GpsCaptureButton` |

---

### 5. Line PD Survey

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | `/api/assets/{id}/pd-surveys` |
| Middleware | none |
| User Roles | Field Operator (write) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| `POST` insert-only — one `surveys` row + N `pd_readings` rows (one per point) per submit. **Never UPDATE/DELETE.** | `Survey`, `PdReading` | Input validation (Zod) before insert; at least 1 point required |

**Frontend:**

| Key Pages | Key Components |
|-----------|-----------------|
| Form opened from Asset Detail Panel | `LinePdSurveyForm`, `PointRowInput`, `GpsCaptureButton` |

---

### 6. Asset Registry

| Item | Detail |
|------|--------|
| Repo | apps |
| Route Prefix | `/api/assets` (POST), `/api/assets/{id}` (PUT — registry corrections only) |
| Middleware | none |
| User Roles | Admin (write) |

**Backend:**

| Key Features | Key Models | Key Services |
|-------------|-----------|--------------|
| `POST /api/assets` create transformer or line; `PUT /api/assets/{id}` metadata correction only (never touches survey/reading rows) | `Asset` | Input validation (Zod) |

**Frontend:**

| Key Pages | Key Components |
|-----------|-----------------|
| Add Asset form (own screen/modal per `wireframe.md`) | `AddAssetForm`, `GpsCaptureButton` |

---

## 3. Dependency Graph

```text
Seed Data → Asset Map — map needs rows to render
Asset Map → Asset Detail & History — detail panel opens from a map click
Asset Detail & History → Transformer Survey — survey form opens from the panel
Asset Detail & History → Line PD Survey — survey form opens from the panel
Asset Map → Asset Registry — new asset must appear on the map immediately after registration
```

All modules live in one Next.js app (`apps/`) — no cross-repo dependency, since this is a Monolith.

---

## 4. Build Order

| Phase | Module | Repo | Urutan | Alasan |
|-------|--------|------|--------|--------|
| 1 | Seed Data + Asset Map | apps | Paling dasar | Nothing else is visible without seeded assets rendering on the map |
| 2 | Asset Detail & History | apps | Setelah Asset Map | Needs asset rows + their survey history to display |
| 3 | Transformer Survey | apps | Setelah Detail Panel | Needs the panel as its entry point and to show the result |
| 4 | Line PD Survey | apps | Paralel dengan #3 | Independent form, same dependency on the detail panel |
| 5 | Asset Registry | apps | Terakhir | P1 — lets a new asset appear before it has any survey, but not required to prove the core map+history concept |

This matches the build order the user specified: seed data + map → detail panel/history → transformer survey form → line PD survey form → add-asset form.
