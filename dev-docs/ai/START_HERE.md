# START_HERE

> Living documentation — see `ai-rules/dev-docs-ai-templates/START_HERE-template.md` for the template this was generated from. This is the onboarding entry point for a new AI agent or engineer. Rewritten 2026-10-21 for the three-folder repository; older files in this folder may still describe the original single-app layout (see "Stale files" below).

---

## Quick Facts

| Item | Value |
|------|-------|
| Product | EverLine, a PD (partial discharge) survey and asset-condition POC for medium-voltage lines and transformers. Older docs call the project `cantol`; Cantol is also the name of the PD sensor device the mobile app talks to. |
| Repository | `dviviantoro/everline` on GitHub, one git repository at the project root |
| Project Type | Fullstack with three code folders: `apps/` (web frontend), `backend/` (API), `mobile/` (Android field app) |
| Git Location | Project root. Remote `origin`, branch `master`. (Older docs say git lives in `apps/` and that `dev` and `main` branches exist; that is no longer true.) |
| Web | `apps/`: Next.js 16 App Router, React 19, Tailwind 4, react-leaflet, Recharts. Frontend only; every request goes through `apps/lib/api.ts`. Hosted on Vercel (https://everline-pi.vercel.app/). Package manager: npm. |
| API | `backend/`: Express + TypeScript + raw `pg` + zod. Docker Compose: `postgres:16-alpine`, MinIO (`quay.io/minio/minio`), Caddy (HTTPS). All routes need the shared `X-API-Key` header. Swagger at `/docs`. |
| Mobile | `mobile/`: Vite 8, React 19, Tailwind 4, Capacitor 8.5 (Android only, minSdk 24, target 36), Rust workspace compiled to WASM and run in a Web Worker. Phase 0 done on the Mac; the app screens do not exist yet. |
| Auth | None. `/login` is a UI-only gate; the API key is a shared safeguard, not authentication. |
| Data | Dummy POC dataset (Pekalongan). Whether real Cantol captures count as real asset data is an open question for the user. |
| Testing | `apps/` and `backend/`: none automated. `mobile/`: 42 Rust tests and 6 Vitest tests, all passing at last run (2026-10-18). |

---

## Recommended Reading Order

1. `dev-docs/ai/FINAL_SYSTEM_HANDOVER.md` — the current state in one place (rewritten 2026-10-21)
2. `dev-docs/ai/TASKS.md` — active work and its order
3. `dev-docs/ai/KNOWN_ISSUES.md` and `dev-docs/ai/TECHNICAL_DEBT.md`
4. `dev-docs/ai/CURRENT_STATE.md` — module maturity and test state (the `Important Nuance` section has several superseded bullets; the notes there mark which)
5. `dev-docs/CHANGELOG.md` — `[Unreleased]` is the real history of the backend split, the pole network model and the mobile app
6. Working on `mobile/`? Then, in order: `dev-docs/decisions/002-mobile-android-capacitor-wasm.md`, `003-hotspot-topology-and-native-rp-transport.md`, `006-mobile-ux-contract.md`, `dev-docs/architecture/mobile-app.md` (technical design), `mobile-ui-spec.md` (what each screen means), `mobile-tracking-mode.md`, `mobile-design-system.md`, `dev-docs/design/mobile/README.md` (visual mock), `mobile/docs/operations/build-apk.md`
7. Working on `backend/`? `backend/README.md`, `planning/api-contract.md`, `planning/schema.sql` (read-only)
8. Working on `apps/`? `apps/README.md`, `dev-docs/architecture/frontend-structure.md`
9. `planning/PROJECT_BRIEF.md`, `planning/architecture.md`, `planning/database.md`, `planning/wireframe.md` — the original blueprint. Immutable. Where it disagrees with the CHANGELOG, CURRENT_STATE or an ADR, the later document wins (the CHANGELOG records each override).
10. `ai-rules/AGENTS.md` — the framework rules you must follow (sections 1, 8 and 10 matter most)

### Stale files (do not trust until TASK-012 refreshes them)

`dev-docs/ai/PROJECT_CONTEXT.md`, `PROJECT_MENTAL_MODEL.md`, `MODULE_MAP.md`, `CODING_RULES.md` and `dev-docs/AGENTS.md` were written on 2026-09-05 for a Next.js monolith on Supabase. They still describe `app/api/**`, `lib/data/*`, Supabase and "Monolith". The code no longer works that way. Use them only for the product-level ideas (insert-only history, severity rollup, pole and measurement-point model) and take the structure from `FINAL_SYSTEM_HANDOVER.md`.

---

## High-Priority Current Work

In this order (details and owners in `TASKS.md`):

1. **TASK-004 (needs the user, not an agent):** install the debug APK on a phone and read the self-test; run the hotspot and device-reachability spike on 2 to 3 phones; add `https://localhost` to `CORS_ORIGIN` in the VPS `backend/.env`.
2. **TASK-005:** app scaffold, sign-in, welcome animation, theme, and the connection wizard (hotspot, Cantol, GPS). The design is ready: `mobile-ui-spec.md`. ADR-006 is Accepted and TASK-010 (the Cantol rename) is done, so use `CantolLink`, `cantolFound` and `CANTOL_*` from the first line.
3. **Decision gate before TASK-006:** where does pulse detection run (Cantol or phone)? It decides whether WASM and the live phase plot exist.
4. **TASK-006, TASK-007:** live pipeline; capture, tag and upload (online only).
5. **TASK-008:** backend ingest hardening (idempotency, transaction, real status codes). Blocks safe offline retry.
6. **TASK-011:** tracking mode. **TASK-009:** offline queue and release. **TASK-012:** refresh stale docs. **TASK-013:** backend security headers and rate limiting. **TASK-014:** second pass on the design mock.

Decisions waiting on the user are listed in `FINAL_SYSTEM_HANDOVER.md` section "Decisions Waiting on the User".

---

## Safety Notes for Agents

- **Never write an UPDATE or DELETE against `surveys`, `transformer_readings` or `pd_readings`.** The history tables are insert-only. This is the one non-negotiable data rule (`planning/architecture.md` section 8, `ai-rules/AGENTS.md`). The mobile app only ever creates surveys.
- `ai-rules/`, `planning/PROJECT_BRIEF.md` and `planning/schema.sql` need explicit user approval to change. Do not edit an existing ADR's text; add a new ADR (006 is the terminology and UX note for 002/003).
- Work in small batches on a feature branch, not directly on `master`, and update `dev-docs/` (TASKS, CURRENT_STATE, CHANGELOG, and KNOWN_ISSUES or TECHNICAL_DEBT when they change) in the same batch. Write a task report in `reports/task/<area>/` (template: `ai-rules/TASK_REPORT_TEMPLATE.md`). Commit logs are indexed in `dev-docs/ai/COMMIT_LOG.md`; the log lags its own commit, so add the hashes after committing.
- No emojis in code, docs, commit messages or UI. The only symbols allowed are the check and cross marks used in checklists and UAT tables.
- Never put credentials, the API key, the hotspot name or password, IP addresses or signing keys in a committed file. The mobile device profile is gitignored; only the `.example` file is committed.
- The provisional PD severity zones (warning from 20, critical from 40 dBmV) exist in three places (`apps/lib/severity.ts`, `backend/scripts/seed.ts`, `mobile/rust/cantol-dsp/src/severity.rs`). Change all three together and flag the change as an assumption (`planning/PROJECT_BRIEF.md` section 16). Do not add a fourth copy; the mobile UI calls the WASM `classify`.
- A browser origin missing from `CORS_ORIGIN` produces an HTTP 500 with no CORS headers, not a clear CORS error. Check the allow-list first when a new client (such as the Capacitor WebView at `https://localhost`) cannot reach the API.
- The API key is public by design: it ships in the web bundle (`NEXT_PUBLIC_API_KEY`) and would ship in the APK. Do not treat it as a secret or build features that rely on it for protection. Real auth and a per-device key are future work.
- Mobile build: use JDK 21 (`source mobile/scripts/env.sh` in every new shell). JDK 26 breaks Gradle.
