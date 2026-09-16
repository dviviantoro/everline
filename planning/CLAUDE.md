# CLAUDE.md

This project uses the `docs-ai` vibe-coding contract. **Read `ai-rules/AGENTS.md` and `planning/PROJECT_BRIEF.md` first** — they're the actual source of truth. This file is a short pointer + the handful of rules that are easy to violate by default, not a replacement for those docs.

## What this is

A map-based POC tracking PLN's 20kV transformers and power lines in Central Java, with historical field-survey data: electrical readings on transformers, partial discharge + temperature readings along lines. Dummy data, deployed on Vercel, backed by Supabase.

## Non-negotiables

- **`surveys`, `transformer_readings`, and `pd_readings` are insert-only.** Never write an UPDATE or DELETE against them — the entire point of the data model is that history is preserved. See `planning/architecture.md` §8 and §11.
- **This is a Monolith** — one Next.js app in `apps/`, not a separate backend + frontend repo. Don't split it.
- **Dummy data only.** Don't connect this to any real PLN system in this phase.
- **A transformer survey = one reading. A line survey = many point readings.** Don't collapse these into one shape — see `planning/database.md`.

## Commands

*(fill in once the app exists — expected: `npm run dev`, `npm run build`, `npm run lint`, run from `apps/`)*

## Docs map

| Need | File |
|------|------|
| Project scope & requirements | `planning/PROJECT_BRIEF.md`, `planning/prd.md` |
| Tech stack & system design | `planning/architecture.md` |
| Database schema | `planning/database.md`, `schema.sql` |
| API contract | `planning/api-contract.md` |
| UI/UX plan | `planning/wireframe.md` |
| Frontend code structure | `dev-docs/architecture/frontend-structure.md` |
| Full AI working contract | `ai-rules/AGENTS.md` (framework root), `dev-docs/ai/AGENTS.md` (this repo) |
| Open questions | `planning/PROJECT_BRIEF.md` §16 |
