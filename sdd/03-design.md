# Design: precio-scanner (Phase 1)

## Architecture overview

```
[raw catalog.json]                      (manual extraction, DevTools)
        │  scripts/normalize-catalog.mjs (Node, tested)
        ▼
[public/data/catalogo.json]  (minimal records)
        ├─► build-time Fuse index   → [catalogo-index.json]
        └─► build-time facet data   → [catalogo-facets.json]
                     │
                     ▼
        Vite React SPA (static, GH Pages)
        ├─ catalog.worker.js     (owns catalog + index: search, filters, sort)
        ├─ lib/catalogLoader.js  (fetch + Cache API + version check)
        ├─ lib/storage.js        (localStorage wrapper)
        ├─ hooks/useSearch.js    (debounce + worker messaging)
        └─ components/           (SearchBar, FilterBar, ProductList, ProductCard)
```

Core decision: **the worker owns the heavy data**. The main thread never holds the
23k-product array; it holds only the visible top-N page and small facet lists. This
keeps typing, scrolling, and filtering responsive — the exact failure mode of the
original app.

## Directory layout

```
public/data/          catalogo.json, catalogo-index.json, catalogo-facets.json
scripts/              normalize-catalog.mjs, generate-index.mjs (build-time, Node)
src/
  workers/catalog.worker.js
  lib/                catalogLoader.js, workerClient.js, storage.js
  hooks/              useSearch.js, useFavorites.js
  components/         SearchBar, FilterBar, ProductList, ProductCard, Skeleton
```

## Data model

```ts
type Product = {
  id: string;        // raw extraction uuid; stableId(nombre) fallback
  nombre: string;
  marca: string;     // always '' for now (source has no brand field)
  categoria: string;
  precio: number;
};
```

Deliberately minimal. No unit fields, no `raw` duplication. Fewer bytes → faster
first load, smaller index, lower memory in the worker.

## Data pipeline (build time)

1. `scripts/normalize-catalog.mjs`: raw extraction → `catalogo.json`.
   Ids come from the raw extraction (source-stable uuids; `stableId` fallback).
   Excludes `enTienda: false` and null/zero prices (counted, reported).
   Fail-loud: <20,000 input records, missing nombre, non-numeric precio →
   non-zero exit.
2. `scripts/generate-index.mjs`: reads `catalogo.json` →
   - `catalogo-index.json` (Fuse pre-index over `nombre` + `categoria`),
   - `catalogo-facets.json` (`{ version, categories, brands, priceBounds }`;
     `brands` is empty until the source provides brand data).
3. A `data.version` content hash is emitted alongside; it keys the client cache
   (FR-4.2) so a new dataset invalidates the browser cache automatically.

Both scripts are pure Node, tested with fixture catalogs (valid, truncated, corrupt).

## Large-catalog client handling

### Loading and caching (`lib/catalogLoader.js`)
- Parallel `fetch` of the three data files, each stored in the Cache API under a
  key that includes `data.version`.
- On boot: if cache hit → hydrate the worker from cached bytes (no network);
  if miss → fetch with progress indication, then store.
- First paint is never blocked: skeleton immediately, catalog hydrates in background.

### Worker (`catalog.worker.js`)
- The worker receives catalog + index bytes, constructs the single `Fuse` instance,
  and answers messages: `{ type: 'search', query, filters, sort, limit }`.
- Returns `{ results: Product[] (≤50), total: number }`. The `total` lets the UI
  show "load more" paging without shipping the whole match set.
- One request in flight; new input cancels (or its response is discarded by
  generation counter on the main thread).

### Rendering
- Top-N list (50) + "load more". No virtualization library in Phase 1: a bounded
  list satisfies the responsiveness requirement with zero extra dependencies.

## Search pipeline

1. Boot: `catalogLoader` hydrates worker (cache or network) → skeleton until ready.
2. `useSearch(query)`: debounce 150 ms → post to worker → results replace current
   page; generation counter drops stale responses.
3. Highlight via Fuse match positions on `nombre`/`marca`.
4. Filters/sort ride in the same worker message; the worker applies them over the
   match set before returning the page.

## State management

Local React state + two hooks (`useSearch`, `useFavorites`). No global store.
`lib/storage.js` wraps localStorage with a `precio-scanner:` prefix and JSON-safe
read/write.

## Styling

Tailwind CSS (via Vite plugin). Mobile-first, single-column list, sticky filter bar.

## Deployment

- `vite.config.js`: `base: '/precio-scanner/'`.
- `.github/workflows/deploy.yml`: checkout → node 20 → `npm ci` → `npm run build`
  → `actions/upload-pages-artifact` → `actions/deploy-pages`. Trigger: push to `main`.
- Pages source set to "GitHub Actions" in repo settings.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Worker + Fuse complexity (serialization bugs) | Keep message schema tiny and typed; Vitest tests for worker client with a mocked worker |
| Stale worker responses race with fast typing | Generation counter; only latest generation renders |
| Cache invalidation after data updates | Versioned cache keys from build-time `data.version` hash; stale entries never read |
| Large JSON hurts first load | Minimal records, gzip via Pages, progress skeleton; index pre-generated (never built in-browser) |
| Catalog becomes stale | Documented as accepted for Phase 1; updater is Phase 2 |
| Raw data has no brand field | `marca` kept as `''` in the model; no brand filter/index in Phase 1; wire it in when a future extraction provides it |
| Zero-price / not-in-store noise | Excluded at normalize time with reported counts |
| Fuse threshold too loose/strict | Threshold constant; tuned against acceptance searches (AC-2, AC-3) |
| GH Pages base-path mistakes | `base` set on day one; deploy verified with a blank page first |

## Testing strategy

- Vitest unit tests: worker message handling (search, filters, sort, paging) against
  a small fixture catalog; catalogLoader cache/version logic with a mocked Cache API.
- Normalization + index scripts tested with fixture raw catalogs (valid, truncated,
  corrupt): exit codes, output shape, id stability.
- Manual acceptance checklist per AC-1..AC-7 after each relevant commit, including
  the network-panel cache-hit check and a long-typing responsiveness pass.
