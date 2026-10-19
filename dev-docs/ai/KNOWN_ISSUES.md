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

---

## Uncertainty Markers

- Assumption based on repository analysis: no automated test suite exists — everything in `dev-docs/ai/CURRENT_STATE.md` Test/QA State was verified manually this session and could regress silently on a future change with no test to catch it.
- Assumption based on repository analysis: the sequential (non-transactional) survey + reading insert (see `dev-docs/ai/TECHNICAL_DEBT.md`) has not been tested under a simulated mid-write failure — only the happy path has been verified live.

---

## Resolved Issues

Nothing resolved yet — this file was just created. Two bugs found and fixed during this session's own testing (the `transformer_readings` embed-shape bug and the map click z-order bug) were caught and fixed within the same session before ever being logged here, so they're recorded directly in `dev-docs/ai/CURRENT_STATE.md` and `dev-docs/CHANGELOG.md` instead. See [RESOLVED.md](./RESOLVED.md) once entries exist here to move.
