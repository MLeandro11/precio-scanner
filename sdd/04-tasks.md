# Tasks: precio-scanner (Phase 1)

Ordered by dependency. Each work unit = one commit (reviewable, tests included).

## Work Unit 1 — Skeleton + deploy

- [ ] 1.1 Scaffold Vite + React + Tailwind project (`npm create vite`), clean template.
- [ ] 1.2 Set `base: '/precio-scanner/'` in `vite.config.js`.
- [ ] 1.3 Add `.github/workflows/deploy.yml` (build + deploy to GH Pages on push to `main`).
- [ ] 1.4 Verify: push → site live at `https://<user>.github.io/precio-scanner/`.

## Work Unit 2 — Data pipeline (normalizer + index)

- [ ] 2.1 Add Vitest; RED tests for `scripts/normalize-catalog.mjs` contract:
      fixture raw catalogs (valid ≥23k simulated, truncated, corrupt), exit codes,
      minimal record shape (`id, nombre, marca, categoria, precio`), stable id hash.
- [ ] 2.2 Implement `scripts/normalize-catalog.mjs`; generate `public/data/catalogo.json`.
      GREEN all tests.
- [ ] 2.3 RED tests for `scripts/generate-index.mjs`: emits Fuse pre-index + facet
      JSON (categories, brands, price bounds) + `data.version` hash from a fixture
      catalog.
- [ ] 2.4 Implement `scripts/generate-index.mjs`; document regeneration command in README.
- [ ] 2.5 TRIANGULATE: run the full real catalog through both scripts; verify
      record count, facet contents, and id uniqueness on real data.

## Work Unit 3 — Catalog loading, caching, and worker

- [ ] 3.1 `lib/catalogLoader.js`: parallel fetch of the three data files with Cache
      API + `data.version` keys. RED tests first with a mocked Cache API (miss →
      fetch → store; hit → no network). GREEN.
- [ ] 3.2 `workers/catalog.worker.js`: receives catalog + index, builds one Fuse
      instance, answers `{ query, filters, sort, limit }` messages with top-N +
      total. Unit tests against a small fixture catalog.
- [ ] 3.3 `lib/workerClient.js` + generation counter: stale responses discarded.
      RED/GREEN tests for the counter logic.
- [ ] 3.4 Boot integration: skeleton while hydrating, worker ready state, no main-
      thread catalog copy. Verify cache-hit boot (AC-4) manually.

## Work Unit 4 — Search

- [ ] 4.1 `hooks/useSearch.js`: debounced query state wired to worker client.
- [ ] 4.2 `SearchBar` + `ProductList` + `ProductCard`: results with highlight
      (Fuse match positions), loading skeleton, top-50 + "load more" paging (AC-5).
- [ ] 4.3 Empty-query state: show favorites/recents (reads storage, even if
      management UI lands in WU6).
- [ ] 4.4 Smoke test: AC-2 ("serenisma") and AC-3 ("cocacola") return expected
      items on real data.

## Work Unit 5 — Filters and sorting

- [ ] 5.1 `FilterBar`: category chips + brand multi-select + price range, populated
      from `catalogo-facets.json` (never from scanning the catalog in main thread).
- [ ] 5.2 Sorting: relevance / price asc / price desc, applied inside the worker.
- [ ] 5.3 Pipeline integration: filters+sort ride the worker message; category-only
      browsing (no query) slices the catalog in the worker.
- [ ] 5.4 Manual acceptance pass: filter combinations over the real catalog stay
      responsive.

## Work Unit 6 — Persistence

- [ ] 6.1 `lib/storage.js` (namespaced, JSON-safe) + `useFavorites` hook.
- [ ] 6.2 Favorite toggle on ProductCard; favorites view from empty-query state.
- [ ] 6.3 Recent searches (dedupe, cap 10) saved on search; shown on empty query.
- [ ] 6.4 Manual acceptance: AC-7 (persistence across reload).

## Work Unit 7 — Hardening and docs

- [ ] 7.1 Tune Fuse threshold against AC-2/AC-3 and a personal list of 10 tricky
      real searches; record final value in design doc.
- [ ] 7.2 Long-typing responsiveness pass (AC-5); record observations.
- [ ] 7.3 README: setup, data regeneration, deploy, known limitations.
- [ ] 7.4 Final acceptance checklist AC-1..AC-7; note results in README (or verify report).

## Phase 2 backlog (separate change, not started here)

- Shopping list panel + cart totals ("lo habitual" quick-load).
- `update.yml` daily cron: extract → normalize → archive snapshot → commit.
- Price history per product id + insights.

## Review workload forecast

Estimated changed lines: well under 400 per work unit. Single-branch delivery on
`main` is acceptable for WU1–WU7; no chained PRs required. No decision pending
before implementation beyond repo name confirmation.
