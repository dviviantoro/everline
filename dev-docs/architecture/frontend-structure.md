# Frontend Structure

> **Status:** DATA FILE — AI MUST update this when frontend structure changes.
> **Purpose:** Documentation of frontend structure: rendering, layout, components, dependencies, asset pipeline.
>
> **Pre-development note:** the codebase doesn't exist yet — this is the *intended* structure Claude Code should build toward. Update this file to match reality once the app exists; don't leave it as an unmet aspiration.

---

## IMMUTABLE -- AI MUST NOT MODIFY THIS FILE. Read this template, then CREATE a NEW file in the output folder (dev-docs/, planning/, etc.) -- DO NOT edit this template.

**What to CREATE in the output folder:** A map of the frontend — how the UI is organized, rendered, and built.

---

## Rendering Model

Next.js App Router, hybrid rendering:
- Server Components for the initial asset list fetch (fast first paint, no client-side loading spinner for the base map data)
- Client Components for anything interactive: the Leaflet map itself, the detail panel, both survey forms, layer toggle
- Data reaches the client via the API routes in `app/api/` (see `planning/api-contract.md`) — no server actions needed for this scope, plain `fetch` calls are enough

---

## Layout Architecture

| Path | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout — fonts, global styles, top bar shell |
| `app/page.tsx` | The map screen (effectively the whole app) |
| `components/map/` | `MapView`, `AssetMarker`, `PDPointMarker`, `LayerToggle` |
| `components/detail/` | `AssetDetailPanel`, `SurveyHistoryTimeline`, `SeverityBadge` |
| `components/forms/` | `TransformerSurveyForm`, `LinePdSurveyForm`, `AddAssetForm`, `GpsCaptureButton` |
| `lib/supabase.ts` | Supabase client instance |
| `lib/types.ts` | Shared TypeScript types matching `planning/database.md` table shapes |

---

## Page Organization

Organized by feature, not by "module" in the traditional MVC sense — Next.js App Router is file-based routing, and this app is intentionally close to a single screen:
- The map (`app/page.tsx`) is the shell; the detail panel and forms are overlays/modals rendered conditionally from client state, not separate routes
- No sidebar/multi-page admin structure — deliberately avoided per `PROJECT_BRIEF.md` §8 ("keep it boring")

---

## Frontend Dependencies

| Dependency | Version | Use |
|-----------|---------|-----|
| `react-leaflet` + `leaflet` | latest stable | Map rendering — markers, polylines, popups |
| `tailwindcss` | latest stable | Styling — utility classes only, no custom CSS framework |
| `@supabase/supabase-js` | latest stable | Database client (reads and inserts) |

*(No chart library included yet — if a PD/temperature trend chart is added later, `recharts` is the natural fit; not needed for MVP scope.)*

---

## Asset Pipeline

- Next.js's built-in build pipeline (Turbopack/Webpack, whichever ships with the installed version) — no separate bundler config needed
- No custom source/output split — standard Next.js `app/` conventions
- Hot reload via `next dev`; production build via `next build`, deployed automatically by Vercel's Git integration on push
