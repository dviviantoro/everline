# COMMIT LOG — Indeks

> Living documentation — see `ai-rules/COMMIT_LOG-template.md` for the template this was generated from. This file is an index only; commit detail lives in `commit-logs/YYYY-MM-DD.md`.

---

## Daily Index

| Date | Repo | Commits | File |
|------|------|---------|------|
| 2026-09-05 | apps | 9 | [commit-logs/2026-09-05.md](./commit-logs/2026-09-05.md) |
| 2026-10-18 | mobile (+ dev-docs) | 3 | [commit-logs/2026-10-18.md](./commit-logs/2026-10-18.md) |
| 2026-10-21 | docs (dev-docs + reports) | 1 | [commit-logs/2026-10-21.md](./commit-logs/2026-10-21.md) |

---

## Rollback Reference

1. Find the date + repo in the index above.
2. Open the matching daily file for the hash.
3. Verify: `cd apps && git log --oneline -20`
4. Rollback: `cd apps && git reset --hard <HASH>`
