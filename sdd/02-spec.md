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
  record has a non-numeric `precio`. Records with `enTienda: false`, null `precio`, or
  `precio <= 0` are excluded (counted and reported, not treated as errors).
- FR-1.4: Output records keep the raw item order; exclusion counts are printed on success.

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

## Non-functional requirements

- NFR-1: Initial load (catalog + index, first visit) under ~3 s on a normal connection;
  repeat visits boot from cache without re-downloading.
- NFR-2: Search latency imperceptible (<50 ms perceived) once loaded, with the UI thread
  never blocked by search work.
- NFR-3: Fully static; no runtime dependency on any backend.
- NFR-4: Worker messaging and cache versioning logic are unit-tested (Vitest).
- NFR-5: *(added)* TypeScript strict (`tsc --noEmit` clean); list/scan math unit-tested in
  Node (`lib/lupa/*.test.ts`).

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

## Out of scope (Phase 1)

Unit-of-measure parsing, price-per-unit comparison, live multi-store comparison, price
history, daily updater, price alerts with data. (Models exist; no simulated data.)