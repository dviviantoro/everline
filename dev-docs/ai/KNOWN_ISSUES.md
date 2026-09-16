# KNOWN_ISSUES

> Living documentation — see `ai-rules/dev-docs-ai-templates/KNOWN_ISSUES-template.md` for the template this was generated from. Only OPEN issues belong here.

---

## Open Issues

| # | Area | Issue | Impact | Status |
|---|------|-------|--------|--------|
| 1 | `components/forms/AddAssetForm.tsx`, `lib/validation.ts` (`createAssetSchema`) | Registering a `line` asset doesn't require at least one route point — an empty `route_geometry: []` passes validation and would render an empty `Polyline` | LOW | Known Workaround (the form's own "+ Add route point" default row makes this hard to hit in normal use; not enforced either client- or server-side) |

---

## Uncertainty Markers

- Assumption based on repository analysis: no automated test suite exists — everything in `dev-docs/ai/CURRENT_STATE.md` Test/QA State was verified manually this session and could regress silently on a future change with no test to catch it.
- Assumption based on repository analysis: the sequential (non-transactional) survey + reading insert (see `dev-docs/ai/TECHNICAL_DEBT.md`) has not been tested under a simulated mid-write failure — only the happy path has been verified live.

---

## Resolved Issues

Nothing resolved yet — this file was just created. Two bugs found and fixed during this session's own testing (the `transformer_readings` embed-shape bug and the map click z-order bug) were caught and fixed within the same session before ever being logged here, so they're recorded directly in `dev-docs/ai/CURRENT_STATE.md` and `dev-docs/CHANGELOG.md` instead. See [RESOLVED.md](./RESOLVED.md) once entries exist here to move.
