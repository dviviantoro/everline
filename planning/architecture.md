# Architecture Plan — PLN 20kV Asset Monitoring (POC)

> **IMMUTABLE -- AI MUST NOT modify this file. Read it as guidance. For output, see the mapping in ai-rules/README.md.**

> **Status:** PLANNING — Created before development begins. Do not change without discussion.
> **Purpose:** Technical blueprint: stack, system design, components, deployment architecture.

---

##  Project Type Declaration

| Item | Value |
|------|-------|
| Project Type | Monolith |
| Git Location | `apps/` — single repo |

---

## 1. Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|----------|
| Backend | Next.js API Routes | latest stable (App Router) | Bundled with frontend — no separate service to deploy/manage for a POC |
| Frontend | Next.js (React) | latest stable (App Router) | Natural fit for Vercel; SSR for initial load, client components for the interactive map |
| Database | PostgreSQL (Supabase) | 15+ | Managed, generous free tier, table editor for seeding dummy data by hand, PostGIS available if ever needed |
| Cache | none | — | Not needed at POC scale |
| Queue | none | — | No background jobs required |
| Search | none | — | Not needed at POC scale |
| Storage | none (POC) | — | Only needed if survey photo/thermal-image attachments are added later |
| Web Server | Vercel (managed) | — | Git-integrated deploy, zero server management |

---

## 2. System Design

### Architecture Pattern

Layered (kept deliberately simple)

**Rationale:** This is a POC validating a concept, not a system built for scale. A single Next.js app + single Postgres database avoids premature complexity (no microservices, no separate API service, no message queue).

### High-Level Diagram

```text
[Browser: Leaflet map + forms] → [Next.js on Vercel: pages + API routes] → [Supabase Postgres]

Read path:  Browser --GET /api/assets--> Next.js API route --select--> Supabase --> JSON --> map render
Write path: Browser --POST /api/assets/:id/*-surveys--> Next.js API route --insert--> Supabase (new survey + reading rows, nothing overwritten)
```

---

## 3. Component Breakdown

| Component | Type | Responsibility | Technology |
|----------|------|---------------|----------|
| Map View | Frontend | Renders transformer markers + line polylines, severity colors, layer toggle | React + react-leaflet |
| Survey Forms | Frontend | Transformer reading form; multi-point PD reading form | React + Tailwind |
| Asset Detail Panel | Frontend | Shows latest reading + history timeline for a selected asset | React |
| API Routes | Backend | CRUD for assets, insert-only endpoints for surveys/readings | Next.js Route Handlers |
| Database | Data | Stores assets, surveys, transformer_readings, pd_readings | Supabase Postgres |

---

## 4. Routing & Middleware Strategy

### Monolith (Next.js)
- `app/(map)/` — main map page
- `app/api/assets/` — asset registry endpoints
- `app/api/assets/[id]/transformer-surveys/` and `app/api/assets/[id]/pd-surveys/` — survey submission endpoints
- No auth middleware in the POC (see `PROJECT_BRIEF.md` §5 for the roles this will need later)

---

## 5. Data Flow

```text
[Survey form submit] → [Client-side validation] → [POST to API route] → [Insert survey + reading row(s)] → [Supabase]
                                                                                                    ↓
                                                                          [Response] → [UI refetches asset detail, shows new reading + updated history]
```

---

## 6. Security Plan

| Area | Strategy |
|------|----------|
| Authentication | None in POC (deferred — see `PROJECT_BRIEF.md` §5 for planned roles) |
| Authorization | None in POC; RBAC (Operator/Engineer/Admin) planned before real data |
| CSRF | Next.js defaults (same-origin API routes) |
| XSS | React's default output escaping |
| SQL Injection | Supabase client uses parameterized queries — no raw string-built SQL |
| File Upload | N/A — no uploads in POC scope |
| Row Level Security | Off while data is dummy; must be enabled with policies before real asset data is stored (Supabase auto-exposes public-schema tables over REST) |

---

## 7. Deployment Architecture

```
Local (next dev) → Vercel Preview (per branch/PR) → Vercel Production (main branch)
```

| Environment | Server | Domain | Branch |
|------------|--------|--------|--------|
| Local | localhost:3000 | — | any `feat/*` |
| Preview | Vercel Preview | auto-generated per PR | any branch |
| Production | Vercel | `<project>.vercel.app` (or custom domain later) | `main` |

---

## 8. Key Decisions

| # | Decision | Rationale | ADR |
|---|----------|--------|-----|
| 1 | Append-only history: `surveys` + reading tables are insert-only | Preserves full audit trail; matches the "historical data" requirement directly | `dev-docs/decisions/001-architecture.md` |
| 2 | Two separate reading tables instead of one generic table | `transformer_readings` and `pd_readings` have fixed, different shapes (1:1 vs 1:many per survey) | `dev-docs/decisions/001-architecture.md` |
| 3 | Plain lat/lng, no PostGIS yet | POC doesn't need spatial queries; upgrade path exists if needed | `dev-docs/decisions/001-architecture.md` |
