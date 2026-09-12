# precio-scanner — SDD Artifacts

Phase 1 planning artifacts (generated before implementation).

| File | Phase | Purpose |
| --- | --- | --- |
| `01-proposal.md` | proposal | Problem, solution, scope, non-goals, success criteria |
| `02-spec.md` | spec | Functional/non-functional requirements + acceptance criteria |
| `03-design.md` | design | Architecture, data model, parser design, risks |
| `04-tasks.md` | tasks | Ordered work units (commit-sized) with TDD checkpoints |

Dependency: proposal → spec → design → tasks.

Status (reconciled 2026-09-12, baseline commit `dd1a943`): **WU1–WU5 implemented,
WU6–WU7 open.** 8 test files / 49 tests green. `04-tasks.md` is the authoritative
ledger — it carries per-item evidence and the recorded deviations.

Open work: favorites (WU6.1/6.2), recents persistence (WU6.3), the AC-1..AC-7
acceptance pass (WU7.4), and the GitHub remote — without it the deploy path
(items 1.4, AC-4, AC-6) stays unverifiable.

`03-design.md` was reconciled in the same pass (`.mjs` module names, `nombre`/`categoria`
index keys, inline skeleton, `barcode` in the data model and search pipeline).
