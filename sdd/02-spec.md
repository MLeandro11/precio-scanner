# Specification: Lupa (was precio-scanner, Phase 1)

> Updated 2026-09-14 for the rebrand (`c34d0e7`): the app is now **Lupa**, the code is
> **TypeScript strict**, and routing/shopping-list/scanning requirements (FR-6…FR-10)
> were added. The original search/data FRs (FR-1..FR-5) still hold; file names below are
> the current `.ts`/`.tsx` ones.

## Functional requirements

### FR-1: Catalog data pipeline
- FR-1.1: A preprocessing script (`scripts/normalize-catalog.ts`) reads the raw
  extraction JSON and emits `public/data/catalogo.json` with minimal records.
- FR-1.2: Each normalized record must contain exactly: `id`, `nombre`, `marca`,
  `categoria`, `barcode`, `precio`. `id` is the raw extraction's own uuid (stable across
  re-extractions; `stableId(nombre)` hash as fallback when missing). `marca` stays `''`
  for now: the source has no brand field (kept so a future extraction can fill it without
  another shape change).
- FR-1.3: The script must fail with a non-zero exit if the INPUT has fewer than 20,000
  records (truncated extraction), an included record is missing `nombre`, or an included
  record has a non-numeric `precio`. Records with null `precio` or `precio <= 0` are
  excluded (counted and reported, not treated as errors). `enTienda` is **not** an exclusion
  criterion: in the real extraction it is `true` for only 8 of 23,230 records, so the flag
  does not mean "available" and excluding on it would empty the catalog.
- FR-1.4: Output records keep the raw item order; exclusion counts are printed on success.
- FR-1.5: Before writing the output, the script must fail with a non-zero exit and write no
  file if the output would be invalid: duplicate product `id`s (they break React keys and the
  favorites/list id-set filters); records not conserved (`products + exclusions` must equal
  the input count — a guard against silently dropped records); or more than 50% of the input
  excluded, which usually signals an upstream rename/rescale of `precio` rather than real
  noise.

### FR-2: Search (Web Worker owned)
- FR-2.1: Search uses Fuse.js over a build-time pre-generated index
  (`public/data/catalogo-index.json`), never assembled at runtime in the browser.
- FR-2.2: All searching and filtering/sorting of results runs inside a Web Worker
  (`src/workers/catalog.worker.ts`); the main thread sends `{ query, filters, sort }`
  messages and receives top-N results only (N = 50).
- FR-2.3: Weighted keys: `nombre` (3), `categoria` (1). `marca` is excluded from the
  index while the source provides no brand data (see FR-1.2).
- FR-2.4: Threshold ~0.35, `ignoreLocation: true`, `includeScore: true` (tunable).
- FR-2.5: Debounced input (150 ms); stale worker responses are discarded (generation
  counter in `workerClient`).
- FR-2.6: Matched text is highlighted in results using Fuse match positions.
- FR-2.7: Empty query shows favorites and/or recent searches instead of the full list.
- FR-2.8: A query that is barcode-like (≥6 digits, no letters) performs an EXACT match
  against `barcode` (separators stripped); an exact hit returns those products with
  priority. No fuzzy matching for codes: a barcode-like query without an exact hit falls
  through to normal search (no false positives on codes). A query containing letters is
  never treated as a code (e.g. `"EAN 77939…"` is a text query).

### FR-3: Filters and sorting
- FR-3.1: Category filter (chips) and price range filter. No brand filter in Phase 1: the
  source has no brand data.
- FR-3.2: Category list and price range bounds are pre-generated at build time
  (`catalogo-facets.json`), never derived by scanning the full catalog in the main thread.
- FR-3.3: Sorting options: relevance (default), price asc, price desc.
- FR-3.4: Filters and sorting run inside the worker over the search result set;
  category-only browsing (no query) slices the catalog in the worker too.

### FR-4: Catalog delivery and caching
- FR-4.1: The app is served fully static from GitHub Pages; no runtime backend.
- FR-4.2: Catalog, index, and facets are cached client-side (Cache API) keyed by a
  content hash/version emitted at build time; a data update invalidates the cache.
- FR-4.3: While loading, the UI shows a skeleton with progress indication; the app must
  never block rendering on the catalog download.
- FR-4.4: Product list renders a bounded top-N list with "load more" paging — never
  thousands of DOM nodes at once.

### FR-5: Persistence (localStorage)
- FR-5.1: Favorites per product id.
- FR-5.2: Recent searches (last ~10), deduplicated.
- FR-5.3: *(added)* The shopping list persists by **EAN** under the key `lupa:lista`
  (entries carry `cantidad` and an `alerta` flag).

### FR-6: Routing and navigation *(added in the rebrand)*
- FR-6.1: The SPA uses `react-router-dom` v7 with `basename = BASE_URL`
  (`/precio-scanner/`) so it works from the GH Pages path.
- FR-6.2: Routes: Home `/`, Search `/buscar` (accepts `?q=`), Scan `/escanear`,
  Product `/producto/:ean`, History `/historial/:ean`, List `/lista`, placeholders for
  `/alertas` and `/perfil`, and a catch-all redirect to `/`.
- FR-6.3: A bottom navigation (floating outline bar) exposes **Inicio · Alertas ·
  [Escanear] · Lista · Perfil**.
- FR-6.4: Home is search-first: a search box deep-links to `/buscar?q=…`, and a "Mi
  lista" summary resolves the persisted EAN list through the worker.

### FR-7: Product detail *(added in the rebrand)*
- FR-7.1: `/producto/:ean` resolves the EAN (or catalog id fallback for barcode-less
  products) through the worker and shows the product with **add to list** and
  **favorite** actions.
- FR-7.2: A favorite toggle on the detail matches the favorites state (AC-7 consistency).

### FR-8: Shopping list *(added in the rebrand)*
- FR-8.1: `lib/lupa/list.ts` provides pure list math keyed by normalized EAN
  (`normalizeEan` strips `\s\-._` and uppercases): `addItem` (increment on duplicate),
  `setCantidad` (0 removes), `removeItem`, `toggleAlerta`, `isInList`.
- FR-8.2: `ListPage` renders the list with quantity controls and a **barcode image view**
  (literal EAN barcode per item for scanning at the store).
- FR-8.3: The list never holds catalog copies; EANs are resolved to products on demand
  through the worker (`useResolveEans`).
- FR-8.4: Multi-store comparison and price alerts are **modelled but not implemented**
  (single store of data today); nothing simulates data that does not exist.

### FR-9: EAN scanning *(added in the rebrand; cross-device in the scanner update)*
- FR-9.1: `/escanear` runs a camera loop through a **single pure-JS decoder (ZXing
  `BrowserMultiFormatReader`)**, so it works on **any device with `getUserMedia`**
  (Chrome/Edge/Android, Safari iOS, Firefox) — no longer Chromium-only. Decodes only the
  EAN/UPC family (`ean_13, ean_8, upc_a, upc_e`), throttled, and reports **one** signal per
  distinct code per window (`lib/lupa/scan.ts` `createScanGate`, 1500 ms cooldown).
- FR-9.2: Unsupported (no `getUserMedia`) and permission-denied contexts degrade to
  **manual EAN entry**, which is always available.
- FR-9.3: A detected/entered EAN resolves to a product and offers "add to list".

### FR-10: Deployment
- FR-10.1: Vite `base: '/precio-scanner/'` (repo-relative assets).
- FR-10.2: GitHub Actions workflow deploys `dist/` to GH Pages on push to `main`.
- FR-10.3: Site loads and searches correctly at
  `https://MLeandro11.github.io/precio-scanner/`.

### FR-11: PWA — install, offline boot, update freshness *(added — recorded from an audit)*
Recorded from a measured audit of the deployed app (baseline in WU9, `04-tasks.md`) rather
than from the original proposal, which never mentioned a service worker. Each clause is
marked with whether the audit found it met.

- FR-11.1: The app is installable to the home screen: a valid Web App Manifest wired from the
  document (`name`/`short_name`, 192px and 512px icons plus a `maskable` one, `start_url`,
  `scope`, `display: standalone`), and it launches standalone. — **Met at the audit.**
- FR-11.2: **After one online visit, the app must boot, load its catalog and search with no
  network at all.** A cold offline start must serve the app shell — document, JS, CSS, worker
  chunk. — **Met as of the service worker landing.** The audit that first recorded this clause
  claimed the catalog half already survived offline through the versioned Cache API (FR-4.2);
  **that was wrong**, and only an end-to-end test with the server stopped showed it:
  `catalogo-facets.json` was fetched network-only by design, and because the boot reads the
  data version from it, a failed facets request failed the whole boot. The app therefore held
  5.5 MB of perfectly good cached data it could never reach. `catalogLoader` now fetches the
  facets network-first with the last known copy as the fallback, so offline the boot proceeds
  on the cached version and the heavy files are served from their versioned keys.
- FR-11.3: A deployed update must reach a returning visitor **without that visitor clearing
  site data**, and no version may serve a stale shell indefinitely. Serving the previous
  release for a bounded, defined window is acceptable; serving it forever is not.
- FR-11.4: Offline degrades honestly. A first-ever visit with no network says so plainly
  instead of rendering a broken or empty shell — the same stance FR-8.4 takes on modelled
  data.
- FR-11.5: On iOS the app launches in standalone mode with the correct theme colour, through
  the manifest plus the platform `apple-*` meta tags. — **Partially met at the audit:**
  `apple-touch-icon` is present; the standalone, status-bar and title tags are not.

## Non-functional requirements

- NFR-1: Initial load (catalog + index, first visit) under ~3 s on a normal connection;
  repeat visits boot from cache without re-downloading.
- NFR-2: Search latency imperceptible (<50 ms perceived) once loaded, with the UI thread
  never blocked by search work.
- NFR-3: Fully static; no runtime dependency on any backend.
- NFR-4: Worker messaging and cache versioning logic are unit-tested (Vitest).
- NFR-5: *(added)* TypeScript strict (`tsc --noEmit` clean); list/scan math unit-tested in
  Node (`lib/lupa/*.test.ts`).
- NFR-6: *(added)* The offline shell cache is versioned, and the version/invalidation decision
  is unit-tested (Vitest) rather than left to an untested cache rule — the standard NFR-4
  already applies to the data cache.

## Acceptance criteria

- AC-1: Given the raw catalog, the normalizer outputs the valid records (≥ 23,000 input,
  exclusions counted) and exits 0; corrupt input exits non-zero with a clear message.
- AC-2: Searching "serenisma" returns La Serenísima products in the top 10.
- AC-3: Searching "cocacola" returns Coca-Cola products (typo-tolerant, brand match).
- AC-4: On a repeat visit, the app boots without re-downloading catalog/index.
- AC-5: While searching over the full catalog, the main thread stays responsive.
- AC-6: A push to `main` results in a live update on GH Pages without manual steps.
- AC-7: Favorites and recent searches survive a full page reload.
- AC-8: *(added)* An EAN added to the list persists across reload and resolves to its
  product; the barcode view renders.
- AC-9: *(added)* After a first online visit, with the network unavailable, a cold start boots
  the app and querying "serenisma" returns La Serenísima results (AC-2) from the cached
  catalog.
- AC-10: *(added)* After a new deploy, a browser still holding the previous version receives
  the new version **without any manual cache clearing**, and is never still serving the
  previous version on the *second* navigation after the deploy.
  — **Measured, and the original wording was wrong.** It asked for "within one navigation",
  which the standard update flow does not guarantee: the navigation that triggers the update
  check is answered by the worker still active at that moment, so the new precache normally
  lands on the next one. Three deploy cycles against a live server measured **2, 1, 2**
  navigations — the lone 1 being the case where the browser's own background update check had
  already run before the navigation. Two is the bound a criterion can assert deterministically;
  "one navigation" would have been a flaky test for something FR-11.3 never required.

## Out of scope (Phase 1)

Unit-of-measure parsing, price-per-unit comparison, live multi-store comparison, price
history, daily updater, price alerts with data. (Models exist; no simulated data.)

**PWA scope note.** FR-11 covers install, offline boot and update freshness only. Push
notifications, background sync, an offline mutation queue and app-store packaging are out of
scope and are not implied by it.