# precio-scanner — SDD Artifacts

Phase 1 planning artifacts (generated before implementation).

| File | Phase | Purpose |
| --- | --- | --- |
| `01-proposal.md` | proposal | Problem, solution, scope, non-goals, success criteria |
| `02-spec.md` | spec | Functional/non-functional requirements + acceptance criteria |
| `03-design.md` | design | Architecture, data model, parser design, risks |
| `04-tasks.md` | tasks | Ordered work units (commit-sized) with TDD checkpoints |
| `05-acceptance-report.md` | verify | AC-1..AC-7 results from the automated browser pass |

Dependency: proposal → spec → design → tasks.

Status (updated 2026-09-12, commit `8cd0298` plus the acceptance script): **WU1–WU6 and
WU7.2/7.3/7.4 done**, with 7.1 partial and 1.4/AC-6 blocked on the missing git remote.
9 test files / 78 tests green; acceptance pass 16/16 in a real browser.
`04-tasks.md` is the authoritative ledger — it carries per-item evidence and the
recorded deviations.

Open work: the Fuse threshold tuning run over a personal list of tricky searches (WU7.1;
the current value, 0.35, is recorded in `03-design.md` and already passes AC-2/AC-3), and
the GitHub remote — without it the deploy path (items 1.4, AC-6) stays unverifiable.

Acceptance evidence: `05-acceptance-report.md` (reproduce with `npm run acceptance`).

`03-design.md` was reconciled in the same pass (`.mjs` module names, `nombre`/`categoria`
index keys, inline skeleton, `barcode` in the data model and search pipeline).
