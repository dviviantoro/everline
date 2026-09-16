# FINAL_SYSTEM_HANDOVER

> Living documentation — see `ai-rules/dev-docs-ai-templates/FINAL_SYSTEM_HANDOVER-template.md` for the template this was generated from. This file may be included in `main` as a handover reference — it contains no credentials, IPs, or secrets; see `.env.example` and `apps/.env.local` (gitignored) for those.

---

## System Identity

| Repo | Branch | Version | Last Commit |
|------|--------|---------|--------------|
| `apps` | `dev` | `0.1.0` (unreleased) | `666f536` |

| Project Type | Monolith |
| Last Updated | 2026-09-05 |
| Handover Agent | Claude Sonnet 5 |

---

## Current Architecture Summary

One Next.js App Router app (`apps/`) serves as both frontend and backend — Route Handlers under `app/api/` are the API, React components under `app/` and `components/` are the UI, and there is no separate service to deploy. The only external dependency is a Supabase-hosted Postgres database, accessed through `@supabase/supabase-js` using the anon key (RLS is off — dummy data only). There is no cache, queue, search, or object storage. The frontend and backend communicate over plain `fetch()` calls to the app's own `/api/` routes; there is no GraphQL, WebSocket, or server-actions layer.

---

## Active Modules Status

| Module | Repo | State | Notes |
|--------|------|-------|-------|
| Seed Data | apps | Beta | 8 transformers + 5 lines in Pekalongan, idempotent |
| Asset Map | apps | Beta | Verified; click z-order bug and `_leaflet_pos` crash both fixed |
| Asset Detail & History | apps | Beta | Verified |
| Transformer Survey | apps | Beta | Verified |
| Line PD Survey | apps | Beta | Verified |
| Asset Registry | apps | Beta | Verified |
| Landing Page | apps | Beta | Live asset stats from Supabase |
| Login | apps | Beta | UI-only gate, no auth backend |
| Auth / RBAC | apps | Planned | Not started — deferred per `planning/PROJECT_BRIEF.md` §5 |

---

## Recent Changes (Since Last Handover)

This is the first handover — see `dev-docs/CHANGELOG.md` `[Unreleased]` for the complete list. In short:

| Date | Repo | Type | Description | Impact |
|------|------|------|-------------|--------|
| 2026-09-05 | apps | feat | Scaffolded the entire MVP: seed data, map, detail panel + history, both survey forms, add-asset form, all API routes | App went from nonexistent to a working, manually-verified MVP |
| 2026-09-05 | apps | fix | `transformer_readings` PostgREST embed-shape bug (every transformer showed "no data yet") | Corrected the list rollup and detail routes |
| 2026-09-05 | apps | fix | Map click z-order — lines rendered after markers intercepted clicks meant for nearby transformers | Reordered `MapView.tsx` layer rendering |
| 2026-09-05 | apps | docs | Added `apps/README.md` onboarding guide | New engineers can set up without reading all of `dev-docs/` |
| 2026-09-05 | apps | fix | Dev server unreachable over forwarded/LAN origin | Added `allowedDevOrigins` to `next.config.ts` |
| 2026-09-05 | apps | feat | Added landing page + login screen, moved map to `/dashboard`, rebranded as GARDU | Three-route structure instead of a single `/` |
| 2026-09-05 | apps | fix | Upstream Leaflet `_leaflet_pos` crash | Patched via `patch-package`, see `dev-docs/ai/TECHNICAL_DEBT.md` |
| 2026-09-05 | apps | feat | Relocated seed data from Semarang to Pekalongan, added a 5th line | Asset codes changed `-SMG-` → `-PKL-` |

---

## Known Issues at Handover

See `dev-docs/ai/KNOWN_ISSUES.md` for the live list. At handover time:

| Area | Repo | Issue | Mitigation |
|------|------|-------|-----------|
| `components/forms/AddAssetForm.tsx` | apps | Registering a line doesn't require ≥1 route point | Low risk, not yet fixed — see `dev-docs/ai/TECHNICAL_DEBT.md` |
| Whole app | apps | No automated test suite | All verification so far is manual — see `dev-docs/ai/TASKS.md` TASK-002 |
| `planning/`, `dev-docs/`, `ai-rules/` | project root | Not under version control — the `apps/` git repo can't track anything outside its own working tree, but `ai-rules/AGENTS.md`'s merge procedure assumes it can (see `dev-docs/ai/CURRENT_STATE.md` for the exact contradiction) | Unresolved — flagged to the user this session |

---

## What Needs to Happen Next

| Priority | Repo | Task | Blockers |
|----------|------|------|----------|
| P1 | apps | Add automated coverage for the insert-only guarantee | None — just needs a test runner decision |
| P2 | apps | Write `dev-docs/architecture/{api-flow,backend-structure,database}.md` | None |
| P3 | apps | First Vercel deployment | Needs a decision on whether to connect a GitHub remote first |

---

## Deployment Notes

| Repo | DB Migration | Config Baru | Restart Service | Notes |
|------|-------------|--------------|------------------|-------|
| `apps` | `schema.sql` already applied manually via the Supabase SQL Editor — not repeatable/idempotent migration tooling (POC scope, `planning/database.md` §6) | `apps/.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `apps/.env.example`) | N/A — not deployed yet | No Vercel project connected yet |

---

## Verification Commands

```bash
# From apps/
npm run lint
npm run build
npm run dev
curl http://localhost:3000/api/assets

# Reset dummy data to a clean state
npm run seed
```
