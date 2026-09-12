# precio-scanner — SDD Artifacts

Phase 1 planning artifacts (generated before implementation).

| File | Phase | Purpose |
| --- | --- | --- |
| `01-proposal.md` | proposal | Problem, solution, scope, non-goals, success criteria |
| `02-spec.md` | spec | Functional/non-functional requirements + acceptance criteria |
| `03-design.md` | design | Architecture, data model, parser design, risks |
| `04-tasks.md` | tasks | Ordered work units (commit-sized) with TDD checkpoints |

Dependency: proposal → spec → design → tasks.

Status (updated 2026-09-12 at commit `fb91fb5`): **WU1–WU6 implemented, WU7 open.**
9 test files / 78 tests green. `04-tasks.md` is the authoritative ledger — it carries
per-item evidence and the recorded deviations.

Open work: the AC-1..AC-7 acceptance pass (WU7.4, which includes the manual AC-4/AC-5/
AC-7 checks), the Fuse threshold recorded in the design doc (WU7.1), responsiveness
observations (WU7.2), README known limitations (WU7.3), and the GitHub remote — without
it the deploy path (items 1.4, AC-4, AC-6) stays unverifiable.

`03-design.md` was reconciled in the same pass (`.mjs` module names, `nombre`/`categoria`
index keys, inline skeleton, `barcode` in the data model and search pipeline).
