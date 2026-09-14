# Tasks: Lupa (was precio-scanner, Phase 1)

Ordered by dependency. Each work unit = one commit (reviewable, tests included).

> **Reconciled 2026-09-12 against baseline commit `dd1a943`; updated 2026-09-14 for the
> Lupa rebrand (`c34d0e7`); 2.7 pass 2026-09-14 on an uncommitted working tree based on
> `68eb113` (that commit is the *base*, not the pass).**
>
> This file had drifted from the code; the 2026-09-12 pass rebuilt it as an evidence-based
> ledger. This 2026-09-14 pass reflects the **TypeScript + rebrand + feature set** merge and
> re-verifies the previously-unverified items on the current code.
>
> The 2.7 pass added output-side guards to the normalizer and corrected a spec/design drift:
> `02-spec.md` FR-1.3 and `03-design.md` both claimed `enTienda: false` records are excluded,
> but the script never excluded on that flag (the arithmetic proves it — 23,230 − 2,899 =
> 20,331, while excluding on `enTienda` would leave ~8 records). The artifacts now match the
> code.
>
> Legend: `[x]` implemented and provable in the repo · `[ ]` not done ·
> `PARTIAL` some of it exists and the missing half is named explicitly.

## Status summary

| Work unit | Done | Partial | Pending |
| --- | --- | --- | --- |
| WU1 Skeleton + deploy | 4 | 0 | 0 |
| WU2 Data pipeline | 6 | 1 | 1 |
| WU3 Loading + worker | 4 | 0 | 0 |
| WU4 Search | 5 | 0 | 0 |
| WU5 Filters + sorting | 4 | 0 | 0 |
| WU6 Persistence | 4 | 0 | 0 |
| WU7 Hardening + docs | 4 | 1 | 0 |
| WU8 Lupa (rebrand + feature set) | 8 | 0 | 0 |
| **Total (42 items)** | **39** | **2** | **1** |

Test suite at the Lupa merge: `npm test` → **11 files, 97 tests, all green**;
`npm run typecheck` → clean. Build: worker chunk 28.75 kB gzip, main bundle 90.61 kB gzip.
After the 2.7 pass: `npm test` → **11 files, 102 tests, all green**; after the WU7.5 pass:
**11 files, 104 tests**. `npm run typecheck` → clean throughout.

Acceptance pass: `npm run acceptance` → **17/17 reproducible** against the real catalog on the
current TypeScript code. History: the harness was **flaky** (three runs on one build gave
**14/17, 17/17, 16/17**) until the 7.5 fix; after it, **6 consecutive runs by an independent
verifier on one fresh build, plus 10 by the implementer, were all 17/17** with no FAIL row.
Wording caveat: 17 rows = **16 PASS + 1 INFO** (`FR-2.8d` is informational) and the summary
line counts the INFO row as passing — pre-existing behaviour, not introduced here.
AC-6 (deploy) verified via a real push.
AC-6 (deploy) verified via a real push.

## Work Unit 1 — Skeleton + deploy

- [x] 1.1 Scaffold Vite + React + Tailwind project (`npm create vite`), clean template.
      — Evidence: `package.json` (react 19.1, vite 7, tailwindcss 4, `@tailwindcss/vite`,
      added: `typescript`, `react-router-dom`, `lucide-react`); `src/index.css:1`.
- [x] 1.2 Set `base: '/precio-scanner/'` in `vite.config.ts`. — Evidence: `vite.config.ts`.
- [x] 1.3 Add `.github/workflows/deploy.yml` (build + deploy to GH Pages on push to `main`).
      — Evidence: checkout → node 20 → `npm ci` → `npm run build` →
      `upload-pages-artifact@v3` → `deploy-pages@v4`.
- [x] 1.4 Verify: push → site live at `https://MLeandro11.github.io/precio-scanner/`.
      — **Done.** Pushed `main` to `MLeandro11/precio-scanner` (public repo, GH Pages free plan);
      re-verified as AC-6 in the Lupa acceptance pass.

## Work Unit 2 — Data pipeline (normalizer + index)

- [x] 2.1 Add Vitest; RED tests for `scripts/normalize-catalog.ts` contract: fixture raw
      catalogs (valid ≥23k simulated, truncated, corrupt), exit codes, minimal record
      shape, stable id hash. — Evidence: `scripts/normalize-catalog.test.ts`,
      `scripts/stableId.test.ts`. The emitted record has **6** fields —
      `{ id, nombre, marca, categoria, barcode, precio }`.
- [x] 2.2 Implement `scripts/normalize-catalog.ts`; generate `public/data/catalogo.json`.
      GREEN all tests.
- [x] 2.3 RED tests for `scripts/generate-index.ts`: emits Fuse pre-index + facet JSON
      (categories, brands, price bounds) + version hash from a fixture catalog.
      — Evidence: `scripts/generate-index.test.ts`.
- [x] 2.4 Implement `scripts/generate-index.ts`; document regeneration command in README.
      — Evidence: script present; `README.md` → "Pipeline de datos".
- [x] 2.5 TRIANGULATE: run the full real catalog through both scripts; verify record
      count, facet contents, and id uniqueness on real data. — Evidence:
      `public/data/catalogo.json` = **20,331 products, 20,331 unique ids** (23,230 input
      − 2,899 excluded); facets = 30 categories, `priceBounds {min: 1, max: 2,123,750}`.
      **Caveat:** verified by inspecting committed artifacts. 2.7 added script-side
      assertions, but nothing yet asserts the *committed* artifact in CI (see 2.7, 2.8).
- [x] 2.6 *(added — FR-2.8)* `barcode` added to the normalized record and surfaced in
      `ProductCard`. — Evidence: `src/lib/types.ts`, `src/components/ProductCard.tsx`.
      19,644 of 20,331 products carry an 8–14 digit code.
- [ ] 2.7 *(added)* Add an automated assertion over the real catalog for record count and
      id uniqueness. — **PARTIAL.** The script-side half is done: `normalize-catalog.ts` now
      fails loud (before writing) on duplicate ids, on a conservation violation
      (`products + exclusions !== input count`), and on >50% of the input excluded
      (`MAX_EXCLUDED_RATIO`); 4 tests were added (`scripts/normalize-catalog.test.ts`, 12
      tests in the file) covering the duplicate-id guard, the exclusion-cap guard and the
      happy path — but **not** the conservation guard, which is unreachable by any input (every
      record either pushes to `products` or increments one of the two counters), making it
      future-proofing rather than coverage. A real-data run reproduces the committed catalog
      byte-for-byte
      (20,331 records / 20,331 unique ids / version `1cc78a044e6fd67a`). **Missing half:** the
      original motivation was "a regression would pass CI" — but CI runs only `npm ci` +
      `npm run build` (`.github/workflows/deploy.yml`), so it never executes the normalizer,
      the tests, the typecheck, or the acceptance pass. Nothing asserts the committed
      `public/data/catalogo.json` either, and `generate-index.ts` has no equivalent guard.
      Tracked as 2.8.
- [ ] 2.8 *(added — revealed by 2.7)* Wire CI to actually verify: run `npm run typecheck`,
      `npm test`, and a `normalize` + `generate-index` run on the real input, failing the job
      if the regenerated catalog differs from the committed one. Today the only CI job is
      `build` + deploy.

## Work Unit 3 — Catalog loading, caching, and worker

- [x] 3.1 `lib/catalogLoader.ts`: parallel fetch of the three data files with Cache API +
      version keys. RED tests first with a mocked Cache API (miss → fetch → store; hit →
      no network). GREEN. — Evidence: `src/lib/catalogLoader.ts`,
      `src/lib/catalogLoader.test.ts` (miss→fetch→store, hit→zero network reads, version
      change→repopulate).
- [x] 3.2 `workers/catalog.worker.ts`: receives catalog + index, builds one Fuse instance,
      answers `{ query, filters, sort, limit }` messages with top-N + total. Tests against
      a small fixture catalog. — Evidence: `src/workers/catalog.worker.ts`,
      `src/lib/searchEngine.ts`, `src/lib/searchEngine.test.ts`.
- [x] 3.3 `lib/workerClient.ts` + generation counter: stale responses discarded. RED/GREEN
      tests. — Evidence: `src/lib/workerClient.ts`, `src/lib/workerClient.test.ts`.
- [x] 3.4 Boot integration: skeleton while hydrating, worker ready state, no main-thread
      catalog copy. Verify cache-hit boot (AC-4). — **Done.** Bootstrap in `src/App.tsx`
      (loading/ready/error screens, catalog released after handoff to the worker); AC-4
      cache-hit is automated — the Lupa acceptance pass shows 0 network requests for
      catalog/index on reload.

## Work Unit 4 — Search

- [x] 4.1 `hooks/useSearch.ts`: debounced query state wired to worker client.
      — Evidence: `src/hooks/useSearch.ts`, `src/lib/searchSession.ts` (150 ms debounce),
      `searchSession.test.ts`.
- [x] 4.2 `SearchBar` + `ProductList` + `ProductCard`: results with highlight (Fuse match
      positions), loading skeleton, top-50 + "load more" paging (AC-5).
      — Evidence: the `src/components/*.tsx` set; `DEFAULT_LIMIT = 50`; paging.
- [x] 4.3 Empty-query state: show favorites/recents. — **Done** via WU6 + the rebrand:
      the empty search surface renders favorite and recent chips that re-render from
      storage; verified by the WU6.3 / AC-7 acceptance checks.
- [x] 4.4 Smoke test: AC-2 ("serenisma") and AC-3 ("cocacola") on real data.
      — **Done.** Automated in `scripts/acceptance.ts`: 10/10 relevant in the top 10 for
      both against the real 20,331-product catalog.
- [x] 4.5 *(added — FR-2.8)* Barcode-like queries (≥6 digits, no letters) match `barcode`
      exactly with priority and never fall into fuzzy matching. — Evidence:
      `src/lib/searchEngine.ts`, covered by `searchEngine.test.ts` + FR-2.8 acceptance
      checks.

## Work Unit 5 — Filters and sorting

- [x] 5.1 `FilterBar`: category chips + price range, populated from `catalogo-facets.json`
      (never from scanning the catalog in the main thread). — Evidence: `FilterBar.tsx`.
      The brand half is deliberately out of scope — the source has no brand field,
      `facets.brands` is `[]`, and FR-3.1 says "no brand filter in Phase 1".
- [x] 5.2 Sorting: relevance / price asc / price desc, applied inside the worker.
      — Evidence: `src/components/SortSelect.tsx`; `searchEngine.ts` sort test.
- [x] 5.3 Pipeline integration: filters+sort ride the worker message; category-only
      browsing (no query) slices the catalog in the worker. — Evidence:
      `searchSession.ts` sends the filter/sort fields; tests cover both cases.
- [x] 5.4 Manual acceptance: filter combinations over the real catalog stay responsive.
      — **Done.** Filters and sort ride the same worker pipeline measured by the AC-5
      long-typing pass (`scripts/acceptance.ts`, 0 frames over 100 ms). The dedicated
      "filter combos" manual pass is superseded by that automated responsiveness check.

## Work Unit 6 — Persistence

- [x] 6.1 `lib/storage.ts` (namespaced, JSON-safe) + `useFavorites` hook.
      — Evidence: `src/lib/storage.ts` + test; `src/hooks/useFavorites.ts` reads once at
      mount and writes from the toggle handler only.
- [x] 6.2 Favorite toggle on ProductCard; favorites view from empty-query state.
      — Evidence: `ProductCard.tsx` (aria-pressed star toggle), `ProductList.tsx`,
      detail page and favorites view. The main thread never holds the catalog, so the
      worker gained an `ids` filter and the session `showFavorites(ids)`.
- [x] 6.3 Recent searches (dedupe, cap 10) saved on search; shown on empty query.
      — Evidence: `searchSession.ts` reports a committed query once through
      `onQueryCommit` (isolated so a storage failure cannot break a run);
      `collections.addRecent` owns trim, minimum length, case-insensitive dedupe,
      proper-prefix replacement and the cap.
- [x] 6.4 Manual acceptance: AC-7 (persistence across reload). — **Automated.**
      `scripts/acceptance.ts`: `localStorage` byte-identical across reload, both chips
      re-render, favorites still resolve ids through the worker (Lupa pass: 16/16).

## Work Unit 7 — Hardening and docs

- [ ] 7.1 Tune Fuse threshold against AC-2/AC-3 and a personal list of 10 tricky real
      searches; record final value in the design doc. — **PARTIAL.** `threshold: 0.35` is
      recorded in `03-design.md` and AC-2/AC-3 pass on real data. The missing half is the
      tuning run over the user's own tricky-search list — it must come from the user's
      habits; inventing it would produce a fake "tuning" pass.
- [x] 7.2 Long-typing responsiveness pass (AC-5); record observations.
      — Evidence: `05-acceptance-report.md` → 43 keystrokes in 1,515 ms, worst frame gap
      33 ms, 0 frames over 100 ms. Automated in `scripts/acceptance.ts`.
- [x] 7.3 README: setup, data regeneration, deploy, known limitations.
      — Evidence: `README.md` covers Stack, Comandos, Pipeline de datos, Estructura,
      Notas técnicas.
- [x] 7.4 Final acceptance checklist AC-1..AC-7; note results in the verify report.
      — Evidence: `sdd/05-acceptance-report.md`; AC-6 verified live. That report predates the
      17th (NAV-back) check and records 16/16; the post-7.5 result is **17/17 reproducible**
      (16 PASS + 1 INFO) — see the acceptance note at the top of this file.
- [x] 7.5 *(added — revealed 2026-09-14)* Make `scripts/acceptance.ts` deterministic.
      — **Done.** Root cause: `src/lib/searchSession.ts` runs an initial unfiltered BROWSE at
      creation, so the old `waitForCards` (a **global** `ul li` selector) resolved on the browse
      page before the URL-seeded query was applied; the following fixed `sleep(300)` then raced
      the 150 ms debounce plus a worker round trip on a 2.1 MB hydrated Fuse index. Signature:
      `first: AYUYA CERCA…` = the catalog's first record, i.e. the browse page — not bad search.
      Fix in three parts: (a) `setQuery` raises `loading` immediately, so the debounce window is
      never reported as settled, and bumps `runId` to invalidate any in-flight run — defensive,
      since a pre-`setQuery` run can otherwise clear `loading` with stale results (both
      `patch({ loading: false })` paths sit behind an `id !== runId` guard); (b) `ProductList`
      carries `data-search-state` (`loading`|`ready`|`error`) + `data-search-query`; (c) the
      harness waits on `state === 'ready' && query === q` instead of any `ul li`, with a content
      wait for AC-7c and a request-log gate for AC-4. Verified: 6 consecutive runs by an
      independent verifier on one fresh build, plus 10 by the implementer, all 17/17.
      An independent browser probe confirmed the stale window is real (`state=loading`,
      `q="serenisma"`, 50 browse cards, `first AYUYA CERCA…` ~576 ms before the settled state)
      and that `data-search-query` alone is **insufficient** — the `ready` half of the predicate
      is load-bearing. **Note:** the live protection comes from `loading: true` in `setQuery`;
      the `runId++` invalidation did not fire in any observed run (it is reachable while typing
      and is covered by a unit test).

## Work Unit 8 — Lupa (rebrand + feature set, `c34d0e7`)

The merge `c34d0e7` shipped the TypeScript migration, the "Lupa" rebrand, routing, and a
feature set that the original Phase 1 spec did not plan. Recorded here as its own work
unit so the ledger stays honest about scope growth.

- [x] 8.1 TypeScript strict migration of app, scripts, worker and tests (`.jsx`/`.mjs` →
      `.ts`/`.tsx`; `strict` + `verbatimModuleSyntax` + `allowImportingTsExtensions`).
      — Evidence: `tsconfig.json`, typed sources in `src/` and `scripts/`;
      `npm run typecheck` clean.
- [x] 8.2 Router + AppLayout + bottom nav + full page set.
      — Evidence: `react-router-dom` v7, `basename = BASE_URL` in `main.tsx`, routes in
      `App.tsx` (Home, Search, Scan, Product, History, List, placeholders, redirect),
      `src/layout/AppLayout.tsx`.
- [x] 8.3 Shopping-list model + persistence.
      — Evidence: `src/lib/lupa/list.ts` (pure EAN-keyed math, `normalizeEan`,
      `ListaItem`/`AlmacenPrecio`/`HistorialPrecio`), `src/hooks/useList.ts`,
      storage key `lupa:lista`, `lib/lupa/list.test.ts`.
- [x] 8.4 ListPage (quantities, barcode-image view) + Home "Mi lista" summary.
      — Evidence: `src/pages/ListPage.tsx` (`lista|codigos` view, `Barcode` component),
      `HomePage.tsx` resolves the EAN list via the worker (`useResolveEans`).
- [x] 8.5 Product detail `/producto/:ean` with add-to-list + favorite.
      — Evidence: `src/pages/ProductPage.tsx` (EAN or id-fallback resolution, add/list
      and star actions).
- [x] 8.6 Scanner: `lib/lupa/scan.ts` scan gate + `useBarcodeScanner` + ScanPage with
      manual EAN fallback.
      — Evidence: `src/lib/lupa/scan.ts` (`createScanGate`, dedupe/cooldown),
      `lib/lupa/scan.test.ts`, `src/hooks/useBarcodeScanner.ts`, `src/pages/ScanPage.tsx`.
      **Updated (scanner update):** the decoder backend is now cross-device — a single
      pure-JS decoder (ZXing `BrowserMultiFormatReader`, EAN/UPC hints, throttled) replaces
      the Chromium-only `BarcodeDetector` path, lazy-loaded with the `/escanear` route so
      the main bundle stays small (@zxing chunk only on open). Verify: typecheck + tests +
      build + acceptance 16/16.
- [x] 8.7 In-house design system.
      — Evidence: `docs/design-system.md` (tokens, light-default with dark block ahead),
      `src/index.css` semantic tokens, `components/ui/{Button,Input,Sheet,Skeleton}.tsx`,
      `Brand.tsx`, `lucide-react`. Components consume `bg-surface`/`text-…`, never bare hex.
- [x] 8.8 Lupa re-verification.
      — Evidence (2026-09-14): `npm run typecheck` clean; `npm test` → 11 files /
      97 tests; `npm run acceptance` → 16/16 PASS; build sizes recorded.

## Phase 2 backlog (separate change, not started here)

- Live multi-store price comparison (models exist: `AlmacenPrecio`).
- `update.yml` daily cron: extract → normalize → archive snapshot → commit.
- Price history per EAN (model: `HistorialPrecio`) + price alerts (`ListaItem.alerta`),
  only once real multi-store/history data exists.

## Deviations from plan

1. **"Each work unit = one commit" was not honored.** WU1–WU5 landed as a single baseline
   commit (`dd1a943`, 42 files, 5,249 insertions) because the project had no git
   repository until 2026-09-12. Per-work-unit history does not exist.
2. **Review workload forecast was wrong.** The predicted "well under 400 lines per work
   unit" was broken by `package-lock.json` plus the generated `public/data/*` artifacts
   (committed because the deploy workflow never reruns the pipeline). Reviewable logic is
   far smaller than the raw diff.
3. **Brand-related work was dropped, not deferred.** See 5.1. `marca` survives in the
   model as `''` so a future extraction can fill it without another shape change.
4. **Repo name is settled**: `precio-scanner`, matching `base` and the workflow. The app
   brand is now **Lupa**; the repo/host path stay `precio-scanner` (matches the GH Pages
   URL), and `README.md` documents the rebrand.
5. **WU6 shipped as two commits, not one** (`57899eb` favorites, `fb91fb5` recents): the
   favorites half alone was 436 insertions across 11 files, over the 400-line guidance.
6. **Scope grew beyond the Phase 1 spec** with the `c34d0e7` merge (TypeScript, router,
   shopping list, EAN scanning, product detail, design system). Documented as WU8 above;
   the FR-2.8 exact-EAN and worker-owns-catalog core are unchanged by it.
7. **Spec/design drift on `enTienda` (corrected 2026-09-14).** `02-spec.md` FR-1.3 and
   `03-design.md` claimed records with `enTienda: false` are excluded, but the script never
   did that and an existing test pinned the opposite. The code was right (the flag is `true`
   for only 8 of 23,230 records, so it does not mean "available") and the artifacts were
   stale; the docs were corrected to match the code, not the other way around.
8. **The 2026-09-14 backlog pass is two changes, not one** (454 insertions / 65 deletions
   across 11 files, over the 400-line review guidance): **2.7** (normalizer guards, 78 test
   lines, 5 `sdd/*.md`) and **WU7.5** (harness, `searchSession`, `ProductList`, their tests).
   The file split is clean — no file belongs to both — so they can land as two commits.
   They must be *reviewed* together only because the 2.7 docs describe WU7.5's subject.

## Review workload forecast

Per work unit, excluding the lockfile and generated data: WU6a landed at 436 insertions
across 11 files — slightly over the 400-line guidance — and was split from WU6b (149).
WU8 landed as a feature-branch merge (`c34d0e7`) rather than a single oversized commit;
single-branch delivery on `main` is acceptable, no chained PRs required.

The GitHub remote is now set (public repo, deploy verified). Remaining open work is WU7.1
(user-supplied tricky-search list), the CI half of 2.7 (tracked as 2.8), and the
`generate-index.ts` guard that 2.7 left uncovered.