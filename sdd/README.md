# Lupa (precio-scanner) — SDD Artifacts

Phase 1 planning artifacts (generated before implementation), kept in sync with the code.

| File | Phase | Purpose |
| --- | --- | --- |
| `01-proposal.md` | proposal | Problem, solution, scope, non-goals, success criteria |
| `02-spec.md` | spec | Functional/non-functional requirements + acceptance criteria |
| `03-design.md` | design | Architecture, data model, parser design, risks |
| `04-tasks.md` | tasks | Ordered work units (commit-sized) with TDD checkpoints (authoritative ledger) |
| `05-acceptance-report.md` | verify | AC-1..AC-7 (and FR/WU extras) results from the automated browser pass |

Dependency: proposal → spec → design → tasks.

## Status (2026-09-14, after the Lupa feature set)

The app was **rebranded from "precio-scanner" to "Lupa"** and migrated to
**TypeScript strict** in the merge `c34d0e7` ("ship Lupa"). Scope grew beyond the
original Phase 1 spec: **shopping list (by EAN), camera + manual EAN scanning, product
detail, list barcode view, and a routed page set**, alongside the original search /
filters / favorites / recents / worker engine.

**2.7 pass (2026-09-14, uncommitted working tree):** the normalizer gained output-side
fail-loud guards (duplicate ids, record conservation, >50% excluded) plus tests, and
`02-spec.md` FR-1.3 / `03-design.md` were corrected where they wrongly claimed records with
`enTienda: false` are excluded — the script never excluded on that flag.

**WU7.5 pass (2026-09-14, uncommitted working tree):** the acceptance harness was made
deterministic. `searchSession.setQuery` now raises `loading` immediately (and invalidates any
in-flight run), `ProductList` exposes `data-search-state` / `data-search-query`, and the
harness waits on `state === 'ready' && query === q` instead of any `ul li` plus a fixed sleep.

**Green now (verified this session):**
- `npm test` → **11 files, 104 tests pass** (97 at the Lupa merge; +5 in the 2.7 pass, +2 in
  the WU7.5 pass).
- `npm run typecheck` → clean (TS strict, `verbatimModuleSyntax`).
- `npm run build` → worker 28.75 kB, main bundle 106.59 kB gzip (90.61 kB at the merge).
- `npm run acceptance` → **17/17, reproducible.** It emits **17** rows (16 PASS + 1 INFO: the
  NAV-back check added in `68eb113`, and `FR-2.8d` is informational). It was **flaky** — three
  runs on one build once gave 14/17, 17/17, 16/17 — until **WU7.5** fixed it; after the fix,
  6 consecutive runs by an independent verifier on one fresh build, plus 10 by the
  implementer, were all 17/17.
- Deploy live and verified at `https://mleandro11.github.io/precio-scanner/`.

**Scanner update (this session):** camera scanning is now **cross-device**. The Chromium-only
`BarcodeDetector` decoder was replaced by a **single pure-JS decoder (ZXing
`BrowserMultiFormatReader`)**, so it works on any device with `getUserMedia` (Safari iOS,
Firefox, Chrome/Edge/Android). ZXing is lazy-loaded with `/escanear` to keep the main bundle
small (main 89 kB gzip; ZXing chunks in its own ~120 kB gzip loaded only on open). Typecheck +
11 test files/104 tests + acceptance 17/17 stay green (see above).

`04-tasks.md` is the authoritative ledger — it carries per-item evidence and the
recorded deviations, including the additions that the rebrand introduced (WU8+).

Open work: **WU7.1** — the Fuse threshold tuning run over the user's own personal list
of tricky searches (current value `0.35` is recorded in `03-design.md` and passes
AC-2/AC-3). **2.7 (partial) / 2.8** — CI still runs only `build` + deploy, so no test,
typecheck, normalizer or acceptance pass is verified on push. The multi-store comparison /
price history / alerts remain **modelled, not implemented**: there is a single store of data
today, and the artifacts are explicit that nothing here simulates data that does not exist.

Acceptance evidence: `05-acceptance-report.md` (reproduce with `npm run build && npm run
preview && npm run acceptance`).

Note: `README.md` (repo root) is the engineering/operations doc; `docs/design-system.md`
documents the in-house mobile-first design tokens. This `sdd/` set is the planning + 
evidence ledger.