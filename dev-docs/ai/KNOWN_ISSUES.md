# KNOWN_ISSUES

> Living documentation — see `ai-rules/dev-docs-ai-templates/KNOWN_ISSUES-template.md` for the template this was generated from. Only OPEN issues belong here.

---

## Open Issues

| # | Area | Issue | Impact | Status |
|---|------|-------|--------|--------|
| 1 | `components/forms/AddAssetForm.tsx`, `lib/validation.ts` (`createAssetSchema`) | Registering a `line` asset doesn't require at least one route point — an empty `route_geometry: []` passes validation and would render an empty `Polyline` | LOW | Known Workaround (the form's own "+ Add route point" default row makes this hard to hit in normal use; not enforced either client- or server-side) |
| 2 | `apps/lib/severity.ts` `agingRate()` (L54-55) | `Number(null)` is 0 and finite, so a reading with a null `pd_magnitude` is kept as 0 in the aging-rate regression instead of being dropped | LOW | Open. The mobile app never sends a null magnitude, so it cannot introduce this; the dashboard behaviour is unchanged. |
| 3 | `backend/src/routes/surveys.ts` (`POST /api/assets/:id/pd-surveys`) | No idempotency and no transaction: a client retry creates a duplicate survey, which skews the aging-rate regression, and a failure part-way leaves a survey with only some of its points | MEDIUM for the mobile app | Open, tracked as TASK-008. Until it lands the mobile app only retries manually. |
| 4 | `backend/src/routes/surveys.ts` L91-94, `backend/src/app.ts` L51-54 | A survey POST for an unknown asset id returns HTTP 500, not 404 (the `if (!survey)` branch is dead code because pg throws); every error status is 500 because the global handler ignores `err.status`. A browser origin missing from `CORS_ORIGIN` also gets a 500 with no CORS headers. | LOW now, MEDIUM for an upload queue that must tell permanent from transient failures | Open, tracked as TASK-008. |
| 5 | `backend/src/routes/uploads.ts`, `backend/src/storage.ts`, `backend/src/app.ts` | The photo upload limits size (10 MB) but does not validate the file type: extension and Content-Type come from the client, the bucket is public-read and served through the host's `/storage/*` path. The backend also sends no security headers and has no rate limiting (`ai-rules/AGENTS.md` rule 9). Read from the code on 2026-10-21; not exploited or tested. | MEDIUM (internet-exposed, behind a key that is public by design) | Open, tracked as TASK-013. |
| 6 | `apps/lib/api.ts`, `NEXT_PUBLIC_API_KEY` | The shared API key is in the browser bundle and would be in the APK, so anyone can extract it and call the API (including uploads). It is a safeguard against casual access, not authentication. | MEDIUM | Accepted for the POC. A per-device key is in TASK-009; real auth is deferred (`planning/PROJECT_BRIEF.md` section 5). |
| 7 | `dev-docs/ai/PROJECT_CONTEXT.md`, `PROJECT_MENTAL_MODEL.md`, `MODULE_MAP.md`, `CODING_RULES.md`, `dev-docs/AGENTS.md`, `ai-rules/AGENTS.md` | Describe the old layout (monolith, git in `apps/`, `dev` and `main` branches, Supabase). An agent following them targets files that no longer exist. `START_HERE` and `FINAL_SYSTEM_HANDOVER` are current. | MEDIUM for agent work, none at runtime | Open, tracked as TASK-012. `ai-rules/` is immutable and needs a user decision. |

---

## Uncertainty Markers

- Assumption based on repository analysis: no automated test suite exists — everything in `dev-docs/ai/CURRENT_STATE.md` Test/QA State was verified manually this session and could regress silently on a future change with no test to catch it.
- Assumption based on repository analysis: the sequential (non-transactional) survey + reading insert (see `dev-docs/ai/TECHNICAL_DEBT.md`) has not been tested under a simulated mid-write failure — only the happy path has been verified live.

---

## Resolved Issues

Nothing resolved yet — this file was just created. Two bugs found and fixed during this session's own testing (the `transformer_readings` embed-shape bug and the map click z-order bug) were caught and fixed within the same session before ever being logged here, so they're recorded directly in `dev-docs/ai/CURRENT_STATE.md` and `dev-docs/CHANGELOG.md` instead. See [RESOLVED.md](./RESOLVED.md) once entries exist here to move.
