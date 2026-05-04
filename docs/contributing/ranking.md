# Contributing: Ranking & Author Scoring

## Ground rules

- Do not add heavy logic in ingestion handlers.
- Keep weight changes in one place: `WEIGHTS` in `scoring-formula.ts`.
- Add tests for any formula change.
- If schema changes are needed, add a new migration SQL file.

## PR checklist

- [ ] Added/updated tests.
- [ ] Verified dirty-author flow remains async.
- [ ] Added migration (if schema changed).
- [ ] Documented formula/version changes.
