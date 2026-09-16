# CODING_RULES

> Living documentation — see `ai-rules/dev-docs-ai-templates/CODING_RULES-template.md` for the template this was generated from. These are conventions already in use in this codebase, not generic best practice.

---

## Part A — Backend Rules (Route Handlers)

### 1) Module and Route Conventions

- Next.js App Router file-based routing under `app/api/`: one `route.ts` per resource, `[id]` dynamic segments for a specific asset, nested static segments for sub-resources (`transformer-surveys/`, `pd-surveys/`).
- Each `route.ts` exports one function per HTTP verb (`GET`, `POST`, `PUT`) — no verb-dispatch switch statements inside a single handler.
- No middleware and no route prefix pattern beyond the file path itself — there is no auth layer to route through (POC scope).

### 2) Authorization Conventions

- None. Every route in `app/api/` is open, matching `planning/api-contract.md` §1 ("Auth Header: none in POC"). Do not add auth checks unless the user explicitly asks — the roles in `planning/PROJECT_BRIEF.md` §5 are documented for a later phase, not implemented.

### 3) Data and Transaction Conventions

- Every POST/PUT body is validated against a zod schema in `lib/validation.ts` before it touches Supabase — see `ai-rules/security/part-d-input-validation-output-sanitization.md`.
- No DB transactions. A survey write is two sequential inserts (`surveys` row, then `transformer_readings`/`pd_readings` row(s)); if the second fails, the `surveys` row is left in place rather than deleted — see the comment in both survey route handlers. This is an accepted tradeoff (`dev-docs/ai/TECHNICAL_DEBT.md`), not an oversight.
- Shared read logic (the "latest survey per asset" rollup) lives in one place, `lib/data/assets.ts`, used by both the server component and the `GET /api/assets` route — don't duplicate that query.
- **Never issue an UPDATE or DELETE against `surveys`, `transformer_readings`, or `pd_readings`.** This is the one rule in this codebase with zero exceptions — see `planning/architecture.md` §8.

### 4) Import Conventions

- Not applicable — there is no bulk data import feature in this app.

---

## Part B — Frontend Rules

### 5) UI Conventions

- Components are split by concern under `components/map/`, `components/detail/`, `components/forms/`, matching `dev-docs/architecture/frontend-structure.md`.
- Tailwind utility classes only — no custom CSS files, no CSS-in-JS. Colors for severity/condition are centralized in `components/detail/SeverityBadge.tsx` (`SEVERITY_DOT`) so the badge and the map markers never drift out of sync.
- No global state library. `MapApp.tsx` is the single state container (selection, layer toggle, open form); everything else takes props/callbacks or fetches its own data in a `useEffect`.
- Client components fetch their own detail data from `/api/` routes rather than receiving everything as props from the server component — only the initial asset list is server-fetched.

### 6) Testing Conventions

- No automated test runner is configured yet (no Vitest/Jest/Playwright dependency in `package.json`). Verification so far has been `npm run lint`, `npm run build`, and ad hoc Playwright scripts run against a live `next dev` server during development sessions — those scripts are not committed to the repo.
- Before this leaves POC stage, add real coverage — see `dev-docs/ai/TASKS.md`.

### 7) Documentation Conventions

- No JSDoc/TSDoc requirement. Comments are reserved for non-obvious WHY (e.g. the `transformer_readings` PostgREST embed shape, the map layer click-order fix) — see the root `CLAUDE.md` house style.
- The API contract lives in `planning/api-contract.md` and is treated as the source of truth for request/response shapes; `lib/types.ts` and `lib/validation.ts` should always match it.
- `dev-docs/ai/*` is maintained per `ai-rules/AGENTS.md` §10 documentation maintenance protocol — update the relevant file(s) at the end of a task rather than letting them drift.
