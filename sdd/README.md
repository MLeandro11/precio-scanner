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

Known artifact drift, not yet fixed: `03-design.md` still names `catalogLoader.js`,
`workerClient.js`, `storage.js` (real files are `.mjs`), lists a `useFavorites` hook
and a `Skeleton` component that do not exist, and its `Product` type omits `barcode`.
