# Tasks: precio-scanner (Phase 1)

Ordered by dependency. Each work unit = one commit (reviewable, tests included).

> **Reconciled 2026-09-12 against baseline commit `dd1a943`.**
>
> This file had drifted from the code. Every box was unchecked while WU1–WU5 were
> implemented, and three items contradicted `02-spec.md`. Status below is
> evidence-based: each `[x]` points at a file, a test, or an artifact.
>
> Legend: `[x]` implemented and provable in the repo · `[ ]` not done ·
> `PARTIAL` some of it exists and the missing half is named explicitly.

## Status summary

| Work unit | Done | Partial | Pending |
| --- | --- | --- | --- |
| WU1 Skeleton + deploy | 4 | 0 | 0 |
| WU2 Data pipeline | 6 | 0 | 1 |
| WU3 Loading + worker | 3 | 1 | 0 |
| WU4 Search | 3 | 1 | 1 |
| WU5 Filters + sorting | 2 | 1 | 1 |
| WU6 Persistence | 4 | 0 | 0 |
| WU7 Hardening + docs | 3 | 1 | 0 |
| **Total (32 items)** | **25** | **4** | **3** |

Test suite at WU6 delivery: `npx vitest run` → **9 files, 78 tests, all green**
(49 across 8 files at the reconciliation above).

Acceptance pass: `npm run acceptance` → **16/16 checks pass** against the real catalog
(see `05-acceptance-report.md`). One criterion, AC-6, is recorded there as NOT VERIFIED
because there is no git remote to push to.

## Work Unit 1 — Skeleton + deploy

- [x] 1.1 Scaffold Vite + React + Tailwind project (`npm create vite`), clean template.
      — Evidence: `package.json` (react 19.1, vite 7, tailwindcss 4, `@tailwindcss/vite`);
      `src/index.css:1`.
- [x] 1.2 Set `base: '/precio-scanner/'` in `vite.config.js`. — Evidence: `vite.config.js:6`.
- [x] 1.3 Add `.github/workflows/deploy.yml` (build + deploy to GH Pages on push to `main`).
      — Evidence: workflow present: checkout → node 20 → `npm ci` → `npm run build` →
      `upload-pages-artifact@v3` → `deploy-pages@v4`.
    - [x] 1.4 Verify: push → site live at `https://MLeandro11.github.io/precio-scanner/`.
          — **Done.** Pushed `main` to `MLeandro11/precio-scanner` (public repo, GH Pages free plan).
## Work Unit 2 — Data pipeline (normalizer + index)

- [x] 2.1 Add Vitest; RED tests for `scripts/normalize-catalog.mjs` contract:
      fixture raw catalogs (valid ≥23k simulated, truncated, corrupt), exit codes,
      minimal record shape, stable id hash.
      — Evidence: `scripts/normalize-catalog.test.mjs`, `scripts/stableId.test.mjs`.
      **Corrected:** the emitted record has **6** fields, not 5 —
      `{ id, nombre, marca, categoria, barcode, precio }` (`scripts/normalize-catalog.mjs:98`).
- [x] 2.2 Implement `scripts/normalize-catalog.mjs`; generate `public/data/catalogo.json`.
      GREEN all tests. — Evidence: 49/49 green; artifact emitted.
- [x] 2.3 RED tests for `scripts/generate-index.mjs`: emits Fuse pre-index + facet
      JSON (categories, brands, price bounds) + `data.version` hash from a fixture
      catalog. — Evidence: `scripts/generate-index.test.mjs` (version hash, priceBounds,
      determinism, missing-input failure).
- [x] 2.4 Implement `scripts/generate-index.mjs`; document regeneration command in README.
      — Evidence: script present; `README.md` → "Data pipeline" section.
- [x] 2.5 TRIANGULATE: run the full real catalog through both scripts; verify
      record count, facet contents, and id uniqueness on real data.
      — Evidence: `public/data/catalogo.json` = **20,331 products, 20,331 unique ids**
      (23,230 raw input − 2,899 excluded); `catalogo-facets.json` = 30 categories,
      `priceBounds {min: 1, max: 2,123,750}`.
      **Caveat:** this was verified by inspecting the committed artifacts. There is **no
      automated test** asserting count or id uniqueness against the real catalog — it is a
      one-off check, so a regression would not be caught. Tracked as item 2.7.
- [x] 2.6 *(added during reconciliation — FR-2.8)* `barcode` added to the normalized
      record and surfaced in `ProductCard`. — Evidence: `scripts/normalize-catalog.mjs:98`,
      `src/components/ProductCard.jsx`. 19,644 of 20,331 products carry an 8–14 digit code.
- [ ] 2.7 *(added during reconciliation)* Add an automated assertion over the real
      catalog for record count and id uniqueness. Today 2.5 is a manual artifact check,
      so a normalize/generate regression that drops or duplicates records would pass CI.

## Work Unit 3 — Catalog loading, caching, and worker

- [x] 3.1 `lib/catalogLoader.mjs`: parallel fetch of the three data files with Cache
      API + `data.version` keys. RED tests first with a mocked Cache API (miss →
      fetch → store; hit → no network). GREEN.
      — Evidence: `src/lib/catalogLoader.mjs`, `src/lib/catalogLoader.test.mjs`
      (miss→fetch→store, hit→zero network reads of the big files, version change→repopulate).
      **Corrected:** the file is `.mjs`, not `.js` (same for `workerClient` and `storage`).
- [x] 3.2 `workers/catalog.worker.js`: receives catalog + index, builds one Fuse
      instance, answers `{ query, filters, sort, limit }` messages with top-N +
      total. Unit tests against a small fixture catalog.
      — Evidence: `src/workers/catalog.worker.js`, `src/lib/searchEngine.mjs`,
      `src/lib/searchEngine.test.mjs`.
- [x] 3.3 `lib/workerClient.mjs` + generation counter: stale responses discarded.
      RED/GREEN tests for the counter logic. — Evidence: `src/lib/workerClient.mjs`,
      `src/lib/workerClient.test.mjs` (supersede + unknown-id discard).
- [ ] 3.4 Boot integration: skeleton while hydrating, worker ready state, no main-
      thread catalog copy. Verify cache-hit boot (AC-4) manually.
      — **PARTIAL.** Done: `src/App.jsx:58-105` (skeleton, ready/error phases, catalog
      released after handoff to the worker). Missing: the manual AC-4 cache-hit check in
      the DevTools network panel — no evidence exists that it was ever run.

## Work Unit 4 — Search

- [x] 4.1 `hooks/useSearch.js`: debounced query state wired to worker client.
      — Evidence: `src/hooks/useSearch.js`, `src/lib/searchSession.mjs` (150 ms debounce),
      `searchSession.test.mjs` ("debounces rapid query typing").
- [x] 4.2 `SearchBar` + `ProductList` + `ProductCard`: results with highlight
      (Fuse match positions), loading skeleton, top-50 + "load more" paging (AC-5).
      — Evidence: `SearchBar.jsx`, `ProductList.jsx`, `ProductCard.jsx`,
      `HighlightedName.jsx`; `searchEngine.mjs:21` `DEFAULT_LIMIT = 50`; "Ver más" paging.
- [ ] 4.3 Empty-query state: show favorites/recents (reads storage, even if
      management UI lands in WU6).
      — **PARTIAL.** Done: recents are read and rendered as clickable chips
      (`src/App.jsx:15,39-54`). Missing: favorites are never read anywhere, and **recents
      are never written** — `setStored` is called from zero application call sites
      (only defined at `src/lib/storage.mjs:17` and used in its own test). The chips can
      only ever render an empty list today.
- [ ] 4.4 Smoke test: AC-2 ("serenisma") and AC-3 ("cocacola") return expected
      items on real data. — **NOT DONE.** `cocacola` appears only in
      `searchEngine.test.mjs` against a 5-product fixture; `serenisma` appears only in
      `sdd/` prose. No test exercises the real 20,331-product catalog.

- [x] 4.5 *(added during reconciliation — FR-2.8)* Barcode-like queries (≥6 digits, no
      letters) perform an exact match against `barcode` with priority, and never fall into
      fuzzy matching. — Evidence: `src/lib/searchEngine.mjs` (barcode map + query
      detection), covered by `searchEngine.test.mjs`.

## Work Unit 5 — Filters and sorting

- [ ] 5.1 `FilterBar`: category chips + brand multi-select + price range, populated
      from `catalogo-facets.json` (never from scanning the catalog in main thread).
      — **PARTIAL, and the brand half is obsolete.** Done: category chips
      (`FilterBar.jsx:28`) + price range from `facets.priceBounds` (`FilterBar.jsx:50-72`),
      both fed from the facet file. Removed from scope: brand multi-select — the source
      extraction has **no brand field**, `facets.brands` is always `[]`, and `02-spec.md`
      FR-3.1 explicitly says "No brand filter in Phase 1". The item as written contradicted
      its own spec.
- [x] 5.2 Sorting: relevance / price asc / price desc, applied inside the worker.
      — Evidence: `src/components/SortSelect.jsx`; `searchEngine.mjs` `sortResults`;
      test "sorts by price asc and desc".
- [x] 5.3 Pipeline integration: filters+sort ride the worker message; category-only
      browsing (no query) slices the catalog in the worker.
      — Evidence: `searchSession.mjs` sends `categoria`/`priceMin`/`priceMax`/`sort`;
      tests "filters by category with and without query", "no query lists all products".
- [ ] 5.4 Manual acceptance pass: filter combinations over the real catalog stay
      responsive. — **NOT DONE.** No recorded pass.

## Work Unit 6 — Persistence

- [x] 6.1 `lib/storage.mjs` (namespaced, JSON-safe) + `useFavorites` hook.
      — Evidence: `src/lib/storage.mjs` + `storage.test.mjs`; `src/hooks/useFavorites.js`
      reads once at mount and writes from the toggle handler only, so mounting can never
      clobber ids stored by an earlier session.
- [x] 6.2 Favorite toggle on ProductCard; favorites view from empty-query state.
      — Evidence: `ProductCard.jsx` (aria-pressed star toggle), `ProductList.jsx`
      (forwards it), `App.jsx` ("★ Favoritos (N)" chip plus a "Volver" button while in
      favorites mode). This needed a new worker capability: the main thread never holds
      the catalog, so favorite products are fetched by id — `searchEngine.runQuery`
      gained an `ids` filter (`null`/`[]` = no restriction) and the session gained
      `showFavorites(ids)`.
- [x] 6.3 Recent searches (dedupe, cap 10) saved on search; shown on empty query.
      — Evidence: `searchSession.mjs` reports a committed query once through
      `onQueryCommit` (never for the initial browse, filters, sort or paging, and
      isolated so a storage failure cannot break a run); `src/hooks/useRecents.js`
      persists it; `collections.addRecent` owns trim, minimum length, case-insensitive
      dedupe, proper-prefix replacement and the cap.
- [x] 6.4 Manual acceptance: AC-7 (persistence across reload).
      — Evidence: `sdd/05-acceptance-report.md`. `localStorage` is byte-identical across a
      reload, both chips re-render, and the favorites view still resolves its ids through
      the worker. Automated in `scripts/acceptance.mjs` — no longer a manual step.

## Work Unit 7 — Hardening and docs

- [ ] 7.1 Tune Fuse threshold against AC-2/AC-3 and a personal list of 10 tricky
      real searches; record final value in design doc.
      — **PARTIAL.** The value (`threshold: 0.35`) is now recorded in `03-design.md`, and
      AC-2/AC-3 pass against the real 20,331-product catalog (`05-acceptance-report.md`).
      Still missing: the tuning run over a personal list of 10 tricky real searches.
      That list has to come from the user's own search habits — inventing it here would
      produce a fake "tuning" pass.
- [x] 7.2 Long-typing responsiveness pass (AC-5); record observations.
      — Evidence: `05-acceptance-report.md` → 43 keystrokes in 1,461 ms, worst gap between
      animation frames 17 ms, 0 frames over 100 ms. Automated in `scripts/acceptance.mjs`,
      so it re-runs instead of being a one-off observation.
- [x] 7.3 README: setup, data regeneration, deploy, known limitations.
      — Evidence: `README.md` now covers Setup, Deployment, Data pipeline, and Known
      limitations.
- [x] 7.4 Final acceptance checklist AC-1..AC-7; note results in README (or verify report).
      — Evidence: `sdd/05-acceptance-report.md` — 16/16 checks pass, reproducible with
      `npm run acceptance`. AC-6 is recorded there as NOT VERIFIED (no git remote).

## Phase 2 backlog (separate change, not started here)

- Shopping list panel + cart totals ("lo habitual" quick-load).
- `update.yml` daily cron: extract → normalize → archive snapshot → commit.
- Price history per product id + insights.

## Deviations from plan

Recorded so the ledger stays honest:

1. **"Each work unit = one commit" was not honored.** WU1–WU5 landed as a single
   baseline commit (`dd1a943`, 42 files, 5,249 insertions) because the project had no
   git repository at all until 2026-09-12. Per-work-unit history does not exist and
   cannot be reconstructed.
2. **Review workload forecast was wrong.** The forecast below predicted "well under 400
   lines per work unit". The baseline commit is 5,249 insertions. The gap is not logic:
   it is `package-lock.json` (2,763) plus the generated `public/data/*` artifacts
   (5.3 MB across 3 single-line JSON files) that must be committed because the deploy
   workflow never reruns the pipeline. Reviewable logic is far smaller than the raw diff.
3. **Brand-related work was dropped, not deferred.** See 5.1. `marca` survives in the
   model as `''` only so a future extraction can fill it without another shape change.
4. **Repo name is settled**: `precio-scanner`, matching `base` and the workflow. The
   "decision pending" note in the original forecast is resolved.
5. **WU6 shipped as two commits, not one** (`57899eb` favorites, `fb91fb5` recents).
   The split is deliberate: the favorites half alone was 436 insertions across 11 files,
   over the 400-line review guidance, and the two halves carry different concerns.

## Review workload forecast

Per work unit, excluding the lockfile and generated data: WU6a landed at 436 insertions
across 11 files — slightly over the 400-line guidance — and was split from WU6b (149
insertions) for that reason. Single-branch delivery on `main` is acceptable for the
remaining WU7 items; no chained PRs required.

The only remaining external dependency is the GitHub remote: until it exists, 1.4, AC-4,
AC-6, and the whole deploy path stay unverifiable.
