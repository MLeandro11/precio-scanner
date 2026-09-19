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
| WU1 Skeleton + deploy | 5 | 0 | 0 |
| WU2 Data pipeline | 6 | 2 | 0 |
| WU3 Loading + worker | 4 | 0 | 0 |
| WU4 Search | 5 | 0 | 0 |
| WU5 Filters + sorting | 4 | 0 | 0 |
| WU6 Persistence | 4 | 0 | 0 |
| WU7 Hardening + docs | 6 | 0 | 1 |
| WU8 Lupa (rebrand + feature set) | 8 | 0 | 0 |
| WU9 PWA (FR-11) | 5 | 0 | 0 |
| **Total (50 items)** | **47** | **2** | **1** |

Test suite at the Lupa merge: `npm test` → **11 files, 97 tests, all green**;
`npm run typecheck` → clean. Build: worker chunk 28.75 kB gzip, main bundle 90.61 kB gzip.
After the 2.7 pass: `npm test` → **11 files, 102 tests, all green**; after the WU7.5 pass:
**11 files, 104 tests**. `npm run typecheck` → clean throughout.

Acceptance pass: `npm run acceptance` → **20/20 reproducible** against the real catalog on the
current TypeScript code, self-served by `scripts/ghpages-server.ts` (GitHub Pages semantics; see
7.6). History: the harness was **flaky** (three runs on one build gave **14/17, 17/17, 16/17**)
until the 7.5 fix; after it, **6 consecutive runs by an independent verifier on one fresh build,
plus 10 by the implementer, were all 17/17**, and the 7.6 rows took it to **20 rows** (19 PASS +
1 INFO).
Wording caveat: the summary line counts the INFO row (`FR-2.8d`, informational) as passing —
pre-existing behaviour, not introduced here.
AC-6 (deploy) verified via a real push; the live deep links are re-verified once 1.5 ships.
AC-6 (deploy) verified via a real push.

## Work Unit 1 — Skeleton + deploy

- [x] 1.1 Scaffold Vite + React + Tailwind project (`npm create vite`), clean template.
      — Evidence: `package.json` (react 19.1, vite 7, tailwindcss 4, `@tailwindcss/vite`,
      added: `typescript`, `react-router-dom`, `lucide-react`); `src/index.css:1`.
- [x] 1.2 Set `base: '/precio-scanner/'` in `vite.config.ts`. — Evidence: `vite.config.ts`.
- [x] 1.3 Add `.github/workflows/deploy.yml` (build + deploy to GH Pages on push to `main`).
      — Evidence: checkout → node 24 → `npm ci` → `npm run build` →
      `upload-pages-artifact@v3` → `deploy-pages@v4`.
- [x] 1.4 Verify: push → site live at `https://MLeandro11.github.io/precio-scanner/`.
      — **Done.** Pushed `main` to `MLeandro11/precio-scanner` (public repo, GH Pages free plan);
      re-verified as AC-6 in the Lupa acceptance pass.
- [x] 1.5 *(added 2026-09-14)* **GH Pages SPA fallback.** The site had no 404 fallback, so every
      hard GET to a subroute returned GitHub's own 404 page and the app never booted: measured
      live, `/buscar`, `/buscar?q=yerba`, `/lista` and `/producto/<ean>` all answered **404**
      while `/` answered 200. Pre-existing since the first deploy (`public/404.html` never
      existed and the workflow had no rewrite step). Impact: reloading on a subroute — normal on
      mobile, where tabs get discarded — landed on a 404, and shared links were broken. The
      URL-driven state fix in `68eb113` *increased* exposure, since the URL bar now holds a real
      deep link that previously did not exist.
      — Fix: `scripts/postbuild.ts` copies `dist/index.html` → `dist/404.html` after the build
      (fail-loud if the copy is not byte-identical), wired as npm's `postbuild` hook so the
      deploy workflow needed no new step. Deep links now boot the shell and the router resolves
      them, with HTTP status 404 (inherent to SPA fallback on Pages; a non-200 for crawlers is
      accepted).
      — **Prerequisite fix:** `deploy.yml` pinned `node-version: 20`, which cannot execute a `.ts`
      entry point, so the new `postbuild` hook would have failed the deploy job; bumped to **24**
      (Node ≥ 23.6 is what `README.md` and `01-proposal.md` already require for the `.ts` CLI
      scripts) and `engines: node >=23.6` recorded in `package.json` so the drift cannot return
      silently. That same pin would also have blocked 2.8.

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
      `build` + deploy. — **PARTIAL.** A `verify` job now gates `deploy` (`needs: verify`) and
      runs `npm run typecheck`, `npm test`, and a regen-and-diff of the search assets. The
      asset check regenerates `public/data/catalogo-index.json` and `catalogo-facets.json`
      from the committed `catalogo.json` and fails on any difference; proven locally to pass
      byte-for-byte on a clean tree and to fail after mutating the catalog. The workflow was
      also given a `contents: read` permission for the verify job, which otherwise inherits
      the workflow's `pages: write` / `id-token: write`.
      **The `normalize` half is not implementable in CI as written:** `scripts/normalize-catalog.ts`
      reads `raw-catalog.json`, which `.gitignore` excludes deliberately ("Raw catalog
      extraction (never commit; keep local only)"). CI therefore cannot re-derive
      `public/data/catalogo.json` from its source of truth, and nothing asserts that a local
      normalize run still reproduces the committed catalog. Closing that half needs the raw
      input published somewhere CI can reach it (artifact store, LFS, or a release asset) — a
      decision, not a code change. The cheap alternative that needs no raw input is the 2.7
      missing half: assert structural invariants (record count, id uniqueness, version) over
      the committed catalog. `scripts/acceptance.ts` is also still outside CI; it needs a
      browser.

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

- [x] 7.1 Tune Fuse threshold against AC-2/AC-3 and a personal list of 10 tricky real
      searches; record final value in the design doc. — **Done**, and through a reproducible
      run rather than a hand check: `scripts/tune-threshold.ts` sweeps thresholds over
      `scripts/tuning-queries.ts` against the real catalog, and `FUSE_OPTIONS` is now
      exported so the sweep tunes the object the app actually ships instead of a copy.
      **4** personal searches were supplied, not 10 — recorded as a shortfall — and the run
      still reached a conclusion. Outcome: **0.35 stands.** Rank and precision@10 are flat
      from 0.25 to 0.40 (see `03-design.md`), so the threshold changes nothing a user can
      perceive; it only sets tail volume, and `0.35→0.40` floods the set ×7.84. The run's
      real value was falsifying its own premise: the broken searches (`coca 2,5` 0/10,
      `zero 1,5` and `yogurt griego` 1/10) are **multi-token** failures that no threshold
      fixes. A precision metric was added mid-run after a stated conclusion turned out to
      be a measurement artifact: a ratio over the *returned* count reported a threshold that
      truncated the set to one correct hit as "100% precision". Tracked as 7.7.
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
- [x] 7.6 *(added 2026-09-14)* **Make the harness test the host's real routing semantics, and
      cover deep links.** The harness reached subroutes with `page.goto` (a real GET) while being
      run against `vite preview`, which silently provides an SPA fallback GitHub Pages does not
      have — so it structurally could not see 1.5. Fix: `scripts/ghpages-server.ts` reproduces
      GitHub Pages semantics (existing file → 200 + Content-Type; unknown path → `dist/404.html`
      with **HTTP 404**; `/` → 302 to the base; nothing outside the root is ever served), and
      `scripts/acceptance.ts` starts that server itself when `BASE_URL` is unset (closed in a
      `finally`), so `npm run acceptance` is a single command that tests the real host contract.
      `BASE_URL` still selects external mode, which is how the harness gets pointed at production.
      Three new rows: `DEEP-search` (hard GET to `/buscar?q=<q>`), `DEEP-reload` (`page.reload()`
      on that subroute — the mid-session reload path that 404'd), `DEEP-prod` (hard GET to
      `/producto/<ean>`). Rows: 17 → **20** (19 PASS + 1 INFO).
      — Evidence: **falsified.** With `dist/404.html` removed, the `DEEP-*` rows fail with their
      own ids and the server answers `404 text/plain`; restored, the harness is green (20/20,
      twice). A port collision on 4173 (`vite preview` also defaults there) fails loudly with
      `EADDRINUSE` instead of silently testing the wrong server.
- [ ] 7.7 *(added — revealed by 7.1)* **Make a multi-word query mean "all the words".**
      `engine.fuse.search(q)` hands the raw string to Fuse as a **single** fuzzy pattern, so
      the query is not "coca AND 2,5". Measured against the real catalog: `coca 2,5` never
      reaches the top 50, even though `COCA COLA X 2.5` and `coca cola zero x 2.5` both
      exist; `zero 1,5` buries `COCA COLA ZERO X 1,5L` under Zero drinks that have no 1.5;
      `yogurt griego` never surfaces the 20 other Greek yogurts. The 7.1 sweep proved no
      threshold touches any of this.
      **A candidate was measured and rejected as-is.** `useExtendedSearch: true` fixes the
      three broken queries (`coca 2,5` → #4, `zero 1,5` → #1) and leaves AC-2/AC-3 at #1, but
      it turns user input into a query language. Measured: `!coca` returns all **20,294**
      products, `=coca` returns **0**, `coca cola` jumps 158 → 1251 hits — and the catalog
      itself carries **61** names containing `'`, `$`, `!` or `=`. Adopting it needs input
      escaping plus tests over those operator characters. A naive per-token set intersection
      was also measured and is **worse**: it discards relevance order, so `coca 2,5`
      surfaces olive oil first.
      Not verifiable by unit tests alone — the evidence lives in the catalog, so extend
      `scripts/tuning-queries.ts` and re-run `scripts/tune-threshold.ts`.

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

## Work Unit 9 — PWA: install, offline boot, update freshness (FR-11)

**Requirement recorded, not started.** The requirement lives in `02-spec.md` FR-11 with AC-9
and AC-10. **No implementation is chosen yet** — that is task 9.1, and it belongs after the
requirement is reviewed.

Measured baseline (2026-09-18, against production `mleandro11.github.io/precio-scanner/`
plus a local `vite preview`):

- **Already correct.** The manifest is complete and valid (`name`, `short_name`,
  `description`, `start_url: "./"`, `scope: "./"`, `display: standalone`, colours) and is
  served as `application/manifest+json`. Icon dimensions read from the files themselves:
  192x192, 512x512, maskable 512x512, apple-touch 180x180, `favicon.ico` with 3 images.
  `theme-color` tracks light/dark from the inline boot script. HTTPS by GH Pages.
- **Also already correct, and this is the expensive half.** The catalog (3.4 MB) and index
  (2.1 MB) are cached through the Cache API under `precio-scanner-data-v1`, keyed by the
  catalog sha256, network only on miss (FR-4.2). **But see the correction below: they were
  unreachable offline until the facets fix.**
- **The gap.** No service worker: `getRegistrations()` → 0, `controller` → `null`,
  `/precio-scanner/sw.js` → **404**. `caches.keys()` returns only
  `precio-scanner-data-v1`, holding exactly `catalogo.json?v=…` and
  `catalogo-index.json?v=…`. **The app shell sits in no app-controlled cache**, and it is only
  ~137 kB (119 kB JS + 7.4 kB CSS + 10.7 kB worker).
- **Why offline fails today.** GH Pages serves `cache-control: max-age=600` for the document,
  the manifest **and** the hashed assets (no `immutable`), so once that window lapses a cold
  offline start cannot fetch `index.html` at all.

**Correction to this baseline (the audit was incomplete).** The line above used to read "the
catalogue is cached, the code that reads it is not". That was only half the story: the *code*
was the visible gap, but `catalogLoader` also fetched `catalogo-facets.json` **network-only**,
and since the boot takes its data version from that file, an offline start died there even with
every heavy file cached. The 5.5 MB were unreachable. Found by stopping a local server and
reloading — not by reading the code, which is why the E2E test existed.
- **iOS.** `apple-touch-icon` is present; `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style` and `apple-mobile-web-app-title` are absent.

- [x] 9.1 Choose and record the implementation in `03-design.md`: `vite-plugin-pwa` over a
      hand-written worker, with the reasoning and the update policy recorded there.
- [x] 9.2 Precache the shell, versioned, satisfying FR-11.2 and FR-11.3; make the
      version/invalidation decision a **pure, unit-tested** function per NFR-6.
      — **Done.** The shell precache works (13 entries, 912 KiB, `data/` excluded) and the
      app-side offline cache decision is covered by tests in `catalogLoader.test.ts`, including
      the distinction between "unreachable network" (fall back) and "server answered badly"
      (stay fatal). AC-10 is proven, with the clause corrected: see `02-spec.md` AC-10 — three
      deploy cycles measured **2, 1, 2** navigations, so two is the assertable bound.
- [x] 9.3 The iOS meta tags and the remaining manifest fields (`id`, `lang`, `dir`,
      `orientation`) for FR-11.5. `mobile-web-app-capable` and `apple-mobile-web-app-title`
      were added; `apple-mobile-web-app-status-bar-style` is deliberately NOT set because
      choosing it is a visual decision that needs a real iOS device to check.
- [x] 9.4 Extend `scripts/acceptance.ts` with the offline row (AC-9); prove AC-10 with two
      consecutive builds against one retained browser profile.
      — **Done.** `OFFLINE` stops the server **for real** instead of emulating offline: a request
      that still reaches the server would succeed, the loader's fallback would never execute,
      and the row would pass without testing anything. It then reloads `/buscar?q=serenisma`
      and requires the settled contract plus La Serenísima results. Falsified rather than
      assumed: with the loader's cache fallback removed, the row fails as `did NOT settle,
      0 result(s), 0 La Serenísima` and names itself in the `FAILED:` line. AC-10 was measured
      by hand across three deploys — see 9.2.
- [x] 9.5 *(risk)* A service worker sits between the deploy and the user, so it can **hide a
      routing bug the harness currently catches**.
      — **Confirmed, and it was worse than the risk as stated.** No row asserted an HTTP status:
      every `DEEP-*` row only asserts that a deep link boots the app, and the worker's
      `navigateFallback` produces that same outcome straight from precache. Because the worker
      calls `clientsClaim`, it controls the page from activation onward, so those rows may never
      reach the host at all. `HOST-404` now asserts the contract **from Node**, which bypasses
      the page and therefore the worker by construction: an unknown path must answer HTTP 404
      with the app shell, and an existing file must still answer 200. The `DEEP-*` caveat is
      recorded on the rows themselves instead of being left implied.

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
9. **CI's Node was below the repo's documented requirement (found 2026-09-14).** `deploy.yml`
   pinned `node-version: 20` while `README.md` and `01-proposal.md` already require Node ≥ 23.6
   for the `.ts` CLI scripts. It went unnoticed because CI only ever ran `vite build`. The 1.5
   fix would have failed the deploy on that pin (a `.ts` postbuild hook cannot run on Node 20),
   so it is now **24**, with `engines: node >=23.6` in `package.json`. The same pin would have
   blocked 2.8 — CI could never have run `normalize`, `generate-index` or `acceptance`.

## Review workload forecast

Per work unit, excluding the lockfile and generated data: WU6a landed at 436 insertions
across 11 files — slightly over the 400-line guidance — and was split from WU6b (149).
WU8 landed as a feature-branch merge (`c34d0e7`) rather than a single oversized commit;
single-branch delivery on `main` is acceptable, no chained PRs required.

The GitHub remote is now set (public repo, deploy verified). Remaining open work is the
multi-token matching defect (7.7), the `normalize` half of 2.7 (tracked as 2.8 — not
implementable in CI while `raw-catalog.json` stays local), and the structural-assertion /
`generate-index.ts` guards that 2.7 left uncovered.