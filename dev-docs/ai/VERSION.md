# VERSION — Tracking & Rekomendasi Versi Rilis

> Living documentation — see `ai-rules/dev-docs-ai-templates/VERSION-template.md` for the template this was generated from and the full SemVer decision rules.

---

## Current Version

| Repo | Current Version | Release Date | Notes |
|------|----------------|---------------|-------|
| `apps` | `0.1.0` | — (not yet released/deployed) | development — matches `apps/package.json`, not yet tagged or deployed |

---

## Next Version Recommendation

### Rekomendasi Rilis

| Repo | Current | Recommended | Bump Type | Alasan |
|------|---------|-------------|-----------|--------|
| `apps` | `0.1.0` | `0.1.0` (no bump needed yet) | — | `package.json` already declares `0.1.0`, and nothing has been deployed/tagged under that version yet. All work in `[Unreleased]` (see `dev-docs/CHANGELOG.md`) — seed data, map, detail panel, both survey forms, add-asset form, two bug fixes — is exactly what constitutes reaching a working `0.1.0`, not a change that should bump past it. |

### Ringkasan Perubahan (dari CHANGELOG `[Unreleased]`)

```
Added: Next.js monolith scaffold, seed data, map view, asset detail + history
timeline, transformer survey form, line PD survey form, add-asset form, all
API routes, planning/modules.md + timeline.md, full dev-docs/ai/* set.
Changed: app/page.tsx forced to dynamic rendering.
Fixed: transformer_readings PostgREST embed-shape bug, map click z-order bug.
```

**When to actually close `[Unreleased]` into `[0.1.0]`:** once this is deployed to Vercel and smoke-tested (`planning/timeline.md` Phase 3, `dev-docs/ai/TASKS.md` TASK-003) — that's the natural point to tag a real `0.1.0` release. Until then, keep accumulating entries under `[Unreleased]`.

### Status Konfirmasi

| Status | User | Tanggal |
|--------|------|---------|
| Pending | — | — |

---

## Version History

No tagged releases yet. The table below will get its first row once `[Unreleased]` is closed (see recommendation above).

| Date | Repo | Version | Type | Key Changes |
|------|------|---------|------|--------------|
| — | — | — | — | — |
