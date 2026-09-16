# START_HERE

> Living documentation — see `ai-rules/dev-docs-ai-templates/START_HERE-template.md` for the template this was generated from. This is the onboarding entry point for a new AI agent or engineer.

---

## Quick Facts

| Item | Value |
|------|-------|
| Repository | `cantol` (PLN 20kV Asset Monitoring POC) |
| Project Type | Monolith |
| Git Location | `apps/` (root of the project is intentionally **not** a git repository) |
| Stack | Next.js App Router (API routes + React 19) + Supabase Postgres |
| DB | PostgreSQL via Supabase, RLS off (dummy data only) |
| Branch dev | `dev` |
| Branch main | `main` |
| Testing | None automated yet — manual verification only (see `dev-docs/ai/CURRENT_STATE.md`) |

---

## Recommended Reading Order

1. `dev-docs/ai/PROJECT_CONTEXT.md` — overview, stack, source structure
2. `dev-docs/ai/PROJECT_MENTAL_MODEL.md` — how to think about this codebase, request/UI patterns, risk hotspots
3. `dev-docs/ai/MODULE_MAP.md` — business module → actual code mapping
4. `dev-docs/architecture/frontend-structure.md` — the only `dev-docs/architecture/*` file that exists so far (`api-flow.md`, `backend-structure.md`, `database.md` are not yet created — see `dev-docs/ai/TASKS.md` TASK-001)
5. `dev-docs/ai/CURRENT_STATE.md` — what's actually built and verified right now
6. `dev-docs/ai/TASKS.md` — active work
7. `dev-docs/ai/KNOWN_ISSUES.md` — known open issues
8. `dev-docs/ai/TECHNICAL_DEBT.md` — accepted tradeoffs and risky areas
9. `dev-docs/ai/VERSION.md` — current version and release recommendation
10. `planning/PROJECT_BRIEF.md`, `planning/architecture.md`, `planning/database.md`, `planning/api-contract.md`, `planning/wireframe.md` — the original blueprint everything above was built from

There is no `dev-docs/deployment/` or `dev-docs/decisions/` yet — nothing has been deployed, and no ADR beyond `ai-rules/decisions/001-architecture.md` (the immutable template) has been written for this project specifically.

---

## High-Priority Current Work

- **Automated test coverage** — currently zero. All verification so far has been `npm run lint`, `npm run build`, and manual browser testing. See `dev-docs/ai/TASKS.md` TASK-002.
- **`dev-docs/architecture/{api-flow,backend-structure,database}.md`** not yet created. See TASK-001.
- **First Vercel deployment** not yet done. See TASK-003.

---

## Safety Notes for Agents

- **Never write an UPDATE or DELETE against `surveys`, `transformer_readings`, or `pd_readings`.** This is the single non-negotiable rule in this codebase (`planning/architecture.md` §8, `CLAUDE.md`).
- `ai-rules/`, `planning/PROJECT_BRIEF.md`, and `schema.sql` require explicit user approval to modify — they are the agreed blueprint, not living documents.
- Git lives **only** in `apps/` — never `git init` at the project root, and always `cd apps` before any git command (`ai-rules/AGENTS.md` §0).
- `transformer_readings` comes back from PostgREST as a single object, not an array — see the comment in `lib/data/assets.ts` before writing any new query that embeds it.
- Severity/condition thresholds anywhere in seed data or forms are placeholders, not final PLN standards — flag any change here as an assumption per `planning/PROJECT_BRIEF.md` §16.
