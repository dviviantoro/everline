# PROJECT_MENTAL_MODEL

> Living documentation — see `ai-rules/dev-docs-ai-templates/PROJECT_MENTAL_MODEL-template.md` for the template this was generated from.

---

## How to Think About This Codebase

This is a single Next.js app that is simultaneously the whole frontend and the whole backend — there is no separate API service to reason about. Think of it as one screen (a map) with everything else — the detail panel, both survey forms, the add-asset form — as overlays on that one screen, not separate pages. The entire data model exists to answer one question: "what is the history of this asset's condition?" — so every write is an insert, never an update, and the codebase should be read with that invariant in mind before touching anything under `app/api/assets/[id]/*-surveys/`.

---

## 1) Architecture Pattern

Layered, but deliberately thin — there is no Controller → Service → Repository → Model chain the way `ai-rules/coding-standards` describes for larger backends. Route Handlers under `app/api/` call the Supabase client directly (via `lib/supabase.ts`), with `lib/data/assets.ts` as the one shared query used by both the server component (`app/page.tsx`) and the `GET /api/assets` route so that logic isn't duplicated. `lib/validation.ts` is the only thing standing between a request body and a database insert. This is an accepted simplification for POC scale (see `dev-docs/ai/TECHNICAL_DEBT.md`), not an oversight.

---

## 2) Request Execution Pattern

A read (e.g. loading the map) goes: `app/page.tsx` (server component) → `lib/data/assets.ts` → Supabase → rendered into `MapApp` as `initialAssets`. After that, all reads are plain client-side `fetch()` calls to `app/api/assets*` routes, which call the same `lib/data/assets.ts` helper or a direct Supabase query.

A write (submitting a survey) goes: a form component (e.g. `TransformerSurveyForm`) → `fetch(POST /api/assets/{id}/transformer-surveys)` → the route handler parses and validates the body with a zod schema from `lib/validation.ts` → inserts a `surveys` row, then a `transformer_readings` row referencing it → returns `{ data, message }`. There is no middleware and no authorization check anywhere (POC has no auth — see `planning/PROJECT_BRIEF.md` §5 for the roles planned for later). Validation happens entirely at the route handler; nothing is trusted from the client beyond what zod allows through.

---

## 3) UI Pattern

Hybrid rendering: `app/page.tsx` is a server component (marked `export const dynamic = "force-dynamic"` so it never serves a stale build-time snapshot) that does the first fetch, then hands off to `MapApp` — a client component that owns all interactive state (selected asset, layer visibility, which form is open, highlighted line points) via plain `useState`. There is no global state library; every child re-fetches or receives callbacks to bubble state up. The Leaflet map itself (`MapView`) is loaded via `next/dynamic` with `ssr: false` since Leaflet needs `window`. Communication with the backend is plain `fetch()` to the app's own `/api/` routes — no server actions, no GraphQL, no separate API client.

---

## 4) Data Migration/Import Mindset

Not applicable — there is no legacy system and no import pipeline. The only "migration" is `schema.sql`, applied once by hand via the Supabase SQL Editor (see `planning/database.md` §6). Dummy data comes exclusively from `scripts/seed.ts`, which is idempotent (it deletes-then-reinserts assets matching its own hardcoded `code` list before seeding) specifically so it's safe to re-run during development — this is a dev-only convenience, not a general migration tool.

---

## 5) Risk Hotspots

- **`transformer_readings` embed shape.** PostgREST returns it as a single object (not an array) in any Supabase query, because of its `UNIQUE` FK to `surveys` — unlike `pd_readings`, which is genuinely one-to-many and does come back as an array. This bit us once already (every transformer showed "no data yet" until fixed in `lib/data/assets.ts` and `app/api/assets/[id]/route.ts`). Any new query that embeds `transformer_readings` needs to account for this from the start.
- **The insert-only guarantee is enforced by convention, not by the database.** Nothing at the schema level stops a future route handler from issuing an `UPDATE`/`DELETE` against `surveys`, `transformer_readings`, or `pd_readings`. This is the single most important rule in the whole codebase (`planning/architecture.md` §8) and there is no automated test guarding it yet.
- **Map layer click priority.** Leaflet's SVG renderer gives click priority to whichever layer was added to the DOM last. `MapView.tsx` deliberately renders `Polyline`s before `AssetMarker`s so a transformer sitting close to a line is still clickable — reordering those two blocks will silently reintroduce that bug.

---

## 6) Current Product Direction

The MVP core is built and manually verified end-to-end against a live Supabase project: seed data + map rendering, asset detail panel + history timeline, both survey forms, and the add-asset form. Immediate next steps are filling in the remaining `dev-docs/` documentation, then deciding on automated test coverage, then a first Vercel deployment (see `dev-docs/ai/TASKS.md`). No pivot in progress.
