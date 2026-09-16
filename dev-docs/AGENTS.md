# AGENTS (AI Working Contract for This Repo)

> **Status:** GUIDANCE FILE — Do NOT replace. AI must follow this contract but MUST NOT modify its contents.
> **Purpose:** Summary of work rules specific to this repository. Complements the root `AGENTS.md`.

---

## IMMUTABLE -- AI MUST NOT MODIFY THIS FILE. Read this template, then CREATE a NEW file in the output folder (dev-docs/, planning/, etc.) -- DO NOT edit this template.

### CRITICAL: Project Type

**Project Type: Monolith.** Single repo at `apps/` — one Next.js app serving both the UI and the API routes. Do NOT create a separate `backend/`/`frontend/` split; sections 3A/3B below are not applicable to this project.

---

## 1) Project Identity

| Item | Value |
|------|-------|
| Project Type | Monolith |
| Repo(s) | `apps/` |
| Git Folder | `cd apps` |

---

## 2) Common Rules (Apply to All Repos)

### Branch and Git Policy

1. Work on `dev` (or `feat/*`), not `main`.
2. Never force-push to `main`/`dev`.
3. Work in small batches: clear changes, clear commits.
4. Preflight: `cd apps && git status && git branch --show-current && git pull --rebase`
5. **Do not modify `ai-rules/`, `planning/PROJECT_BRIEF.md`, or `schema.sql` without explicit user approval** — these are the agreed-upon blueprint, not a living document.

### Change Scope Rules

- Avoid large refactors without a direct need.
- Do not touch sensitive configuration/secrets (`.env`, Supabase service role key).
- Focus on root cause, not symptom patching.
- **Never write an UPDATE or DELETE against `surveys`, `transformer_readings`, or `pd_readings`.** This data model is insert-only by design (see `planning/architecture.md` §8) — this isn't a technical detail, it's a core architecture decision for this project.
- Code structure follows Next.js App Router convention: `app/` for pages + API routes, `components/` for UI, `lib/` for the Supabase client and shared types (see `dev-docs/architecture/frontend-structure.md`).

### Commit Message Format + COMMIT_LOG

Format: `type: short title`

Body (2-5 lines):
- What was done
- Why it was done
- Impact of the change

Co-authored-by: Claude

**COMMIT_LOG:** Every commit must be logged in `dev-docs/ai/commit-logs/YYYY-MM-DD.md` + the index updated in `COMMIT_LOG.md`.

---

## 3A/3B) Backend/Frontend-Specific Rules

**Not applicable** — this is a Monolith. Next.js unifies backend (API routes) and frontend (React components) in one codebase and one set of conventions, covered in Common Rules above and in `dev-docs/architecture/frontend-structure.md`.

---

## 4) Repo README Maintenance (Required!)

The code repo (`apps/`) MUST have a `README.md` that is always kept up to date.

- **Template:** See `REPO_README_TEMPLATE.md`
- **When to update:** Every milestone / significant change completed
- **Minimum content:** tech stack, setup instructions (`npm install`, required `.env`, `npm run dev`), project structure, module list
- **Path:** `apps/README.md`

The repo README must be usable to onboard a new engineer without reading the entire dev-docs/.

---

## 5) Task Reporting Rules

Every time a task is finished + pushed, write a report at `reports/task/YYYY-MM-DD-{task}.md`.

Contents: description, purpose, files changed, before vs. after snapshot, UAT.
Independent UAT is required before pushing — test the happy path and edge cases (especially: submitting a new survey does not delete or modify old surveys).

---

## 5) Communication Style

- Concise, straight to the result.
- Distinguish fact from assumption. For uncertainty, write: **Assumption based on repository analysis**.
- Use table format for structured data.
- Always give the full file path when referring to code.
- Severity thresholds (PD magnitude, load/temperature) are not final yet — see `PROJECT_BRIEF.md` §16. Do not hardcode threshold numbers without flagging them as an assumption.
