# LAPORAN TASK MOBILE

Tanggal: 2026-10-21
Task: Handoff - repository review, mobile UX contract (ADR-006) and refreshed entry-point docs (no TASK id; creates TASK-010 to TASK-014)
Repo: everline (single repository, project root)
Branch: to be created from `master` when applied (suggested `docs/mobile-ux-contract`)
Commit: not committed yet (based on `dd95242`)

1) Deskripsi Perubahan

Documentation only. A read-only review of the repository at `dd95242` found that the agent entry points still described the old Next.js + Supabase monolith, so `START_HERE.md` and `FINAL_SYSTEM_HANDOVER.md` were rewritten for the real three-folder layout (`apps/`, `backend/`, `mobile/`). The mobile design work done outside the repository (11-screen mock, sign-in and welcome animation, theme, tracking mode) was reconciled with the real data model and turned into a contract: ADR-006 (Proposed), a screen-to-API spec, a tracking-mode design, a design-system file and the mock itself as a visual reference. Five new tasks (TASK-010 to TASK-014) and amendments to TASK-005 to TASK-007 record the work that follows. An earlier standalone build guide produced in the chat assumed a different stack (pnpm monorepo, bearer auth, JSON/WebSocket protocol, SQLite); it was wrong for this repository and is superseded by these files.

No code, schema, API, `ai-rules/`, `planning/` or `schema.sql` was changed.

2) Tujuan dan Manfaat

- Give the next agent or engineer an accurate entry point (stack, layout, commands, safety rules, open decisions) instead of a 2026-09-05 description of a different architecture.
- Put the mobile UX decisions in the repo's own record system (ADR, architecture docs, tasks) before the first screen is coded, so naming (Cantol), wizard order, units (dBmV) and asset scope are settled once.
- Make the review findings (stale docs, missing security headers and rate limiting, upload without MIME allow-list, public API key, no root `.gitignore`) visible and tracked.
- Make the remaining user decisions explicit and numbered.

3) Daftar File yang Diubah

New:
- dev-docs/decisions/006-mobile-ux-contract.md
- dev-docs/architecture/mobile-ui-spec.md
- dev-docs/architecture/mobile-tracking-mode.md
- dev-docs/architecture/mobile-design-system.md
- dev-docs/design/mobile/README.md
- dev-docs/design/mobile/mock/*.dc.html (11 files)
- reports/task/mobile/2026-10-21-handoff-ui-contract.md

Rewritten:
- dev-docs/ai/START_HERE.md
- dev-docs/ai/FINAL_SYSTEM_HANDOVER.md

Edited:
- dev-docs/ai/TASKS.md (TASK-005, 006, 007 amended; TASK-009 note; TASK-010 to TASK-014 added)
- dev-docs/ai/KNOWN_ISSUES.md (items 5 to 7)
- dev-docs/ai/TECHNICAL_DEBT.md (five rows)
- dev-docs/ai/CURRENT_STATE.md (last-updated line, module row, "read this first" note)
- dev-docs/CHANGELOG.md (new `[Unreleased]` entry)
- dev-docs/architecture/mobile-app.md (amendment note under the status line)

Not changed on purpose: ADR-002, ADR-003, `ai-rules/**`, `planning/**`, `dev-docs/ai/COMMIT_LOG.md` and `commit-logs/` (entries are added after committing), `VERSION.md` (no release change), and the stale `PROJECT_CONTEXT`, `PROJECT_MENTAL_MODEL`, `MODULE_MAP`, `CODING_RULES`, `dev-docs/AGENTS.md` (TASK-012).

4) Snapshot Kode (Before -> After)

4.1 Entry point: project type and git layout

File: dev-docs/ai/START_HERE.md

Before:
```
| Project Type | Monolith |
| Git Location | `apps/` (root of the project is intentionally **not** a git repository) |
| Stack | Next.js App Router (API routes + React 19) + Supabase Postgres |
| Branch dev | `dev` / Branch main | `main`
```

After:
```
| Project Type | Fullstack with three code folders: apps/ (web frontend), backend/ (API), mobile/ (Android field app) |
| Git Location | Project root. Remote origin, branch master. (Older docs say ... no longer true.) |
| Web / API / Mobile | Next.js 16 + React 19 + Tailwind 4 (frontend only) / Express + pg + Docker Compose / Vite 8 + Capacitor 8.5 + Rust-WASM |
```

4.2 Mobile wizard order

File: dev-docs/architecture/mobile-app.md (amendment note) and ADR-006 decision 2

Before:
```
hotspot -> device -> permissions -> GPS   (state PERMS separate, states RP_*)
```

After:
```
sign in -> hotspot -> Cantol -> GPS (location permission requested on the GPS step, PERMS folded into LOCATION, states CANTOL_*)
```

4.3 Task list

File: dev-docs/ai/TASKS.md

Before:
```
TASK-005..009 only; TASK-006 gate says "RP or phone"
```

After:
```
TASK-010 Cantol rename (before TASK-005), TASK-011 tracking mode, TASK-012 stale-docs refresh,
TASK-013 backend hardening, TASK-014 second mock pass; TASK-005/006/007 point at mobile-ui-spec.md
```

5) Verifikasi UAT (User Acceptance Test)

| # | Tes | Hasil | Detail |
|---|-----|-------|--------|
| 1 | Repository state read at `dd95242`; upstream `origin/master` equals it at review time | ✅ | `git fetch` then `rev-parse` |
| 2 | Stack, versions, commands and file facts in the two rewritten entry points checked against the code (`package.json` files, `backend/src`, `mobile/docs/operations/build-apk.md`, `ai-rules/AGENTS.md`) | ✅ | One wrong claim (a stale PostgREST note) was found and removed |
| 3 | Every backticked file path in the new and edited docs resolves, or is a file the doc says does not exist yet | ✅ | Remaining unresolved paths are future files (`mobile/config/device-profile.local.json`, `mobile/src/assets/logo.png`, `scripts/check-no-secrets.sh`) or stale references in pre-existing text (`lib/data/assets.ts`) |
| 4 | No emojis or decorative symbols in the new and edited docs (only the check and cross marks in checklists) | ✅ | Scripted scan |
| 5 | No credentials, API keys, real IPs or hotspot passwords in new files | ✅ | Scripted scan. The mock contains a private-range sample address (`192.168.43.112`) and a placeholder network name, both labelled as samples in the design README |
| 6 | Dark-theme tokens and fonts in the spec equal `apps/app/globals.css` and `apps/app/layout.tsx` | ✅ | Compared value by value |
| 7 | Text contrast of the palette | ✅ | Computed WCAG ratios, all text pairs at least 4.5:1; control borders are 1.7 to 1.9:1 and logged as debt |
| 8 | Logo animation timings in the design-system file copied from the mock's keyframes | ✅ | Compared against `Splash.dc.html` |
| 9 | Mock renders correctly with the repo's fonts (IBM Plex Sans is wider than the earlier font) | ❌ | Not checked visually; text overflow is possible. First item in TASK-014 |
| 10 | Mock numbers and units match the data model | ❌ | Mock is in mV and uses free-text asset ids; documented as a known difference with the action to take (TASK-014) |
| 11 | Spec thresholds (25 m GPS accuracy, 1.5 dB, 3 dB, 6 dB, 5 s dwell, 20/30/40 dBmV presets) | n/a | Assumptions, not tested; flagged in the docs and as decision 5 |
| 12 | Anything run on a phone, a VPS or Vercel | n/a | Not possible from this session; no claim is made about runtime behaviour |
| 13 | A new survey never mutates an old one (standing UAT) | n/a | No code path changed |

6) Usulan update README folder kode (ai-rules/AGENTS.md rule 8, draft for approval, not applied)

- `mobile/README.md` does not exist. Proposed new file (short): what the app is, status (Phase 0), how to build (`source scripts/env.sh`, `scripts/android-build.sh`, link to `docs/operations/build-apk.md`), where the design lives (`dev-docs/architecture/mobile-*.md`, ADR-002/003/006), rule that secrets stay in gitignored files.
- `backend/README.md`: add a "Clients" note that the Capacitor WebView origin `https://localhost` must be in `CORS_ORIGIN`, and a link to KNOWN_ISSUES 5 (upload hardening).
- `apps/README.md`: no change needed for this batch.
