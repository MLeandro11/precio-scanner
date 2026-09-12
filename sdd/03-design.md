# Design: precio-scanner (Phase 1)

> Reconciled 2026-09-12 against commit `a75ba32`. Corrected against the code: the lib
> modules are `.mjs`, the Fuse index keys are `nombre`/`categoria`, the skeleton is inline
> in `App.jsx` rather than a component, and `barcode` was missing from the data model and
> the search pipeline (FR-2.8).

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
        ├─ lib/catalogLoader.mjs (fetch + Cache API + version check)
        ├─ lib/storage.mjs       (localStorage wrapper)
        ├─ hooks/                (useSearch, useFavorites, useRecents)
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
  lib/                catalogLoader.mjs, workerClient.mjs, storage.mjs
  hooks/              useSearch.js, useFavorites.js, useRecents.js
  components/         SearchBar, FilterBar, ProductList, ProductCard, HighlightedName
                      (loading skeleton is inline in App.jsx, not a component)
```

## Data model

```ts
type Product = {
  id: string;        // raw extraction uuid; stableId(nombre) fallback
  nombre: string;
  marca: string;     // always '' for now (source has no brand field)
  categoria: string;
  barcode: string;   // EAN/code, '' when the source row has none; exact-match key (FR-2.8)
  precio: number;
};
```

Deliberately minimal. No unit fields, no `raw` duplication. Fewer bytes → faster
first load, smaller index, lower memory in the worker. `barcode` is carried despite
being unindexed because exact code lookup needs it on every record.

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

### Loading and caching (`lib/catalogLoader.mjs`)
- Parallel `fetch` of the three data files, each stored in the Cache API under a
  key that includes `data.version`.
- On boot: if cache hit → hydrate the worker from cached bytes (no network);
  if miss → fetch with progress indication, then store.
- First paint is never blocked: skeleton immediately, catalog hydrates in background.

### Worker (`catalog.worker.js`)
- The worker receives catalog + index bytes, constructs the single `Fuse` instance,
  and answers messages: `{ type: 'query', query, ids, categoria, priceMin, priceMax,
  sort, limit, offset }` (`ids` is the favorites-mode filter; null or empty means
  no restriction).
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
   page; generation counter drops stale responses. When the debounce commits a
   non-blank query, the session reports it once through `onQueryCommit` so the
   caller can persist it as a recent search. Only real query commits are reported
   — the initial browse, filters, sort and paging are not — and the callback is
   isolated so a failing storage write can never break a run.
3. Highlight via Fuse match positions on `nombre`/`categoria`.
4. Filters/sort ride in the same worker message; the worker applies them over the
   match set before returning the page.
5. Barcode-like queries (≥6 digits, no letters) short-circuit fuzzy search entirely:
   `createEngine` builds a `Map<barcode, Product[]>`, and an exact hit is returned with
   priority. No exact hit falls through to normal search, never to a fuzzy code
   near-miss (FR-2.8). Codes are the one query class where a wrong answer is worse than
   no answer.
6. Favorites mode: `showFavorites(ids)` clears any pending debounced query, sets
   `ids` and runs immediately. The worker then restricts the match set to those ids
   (`total` included, so paging stays honest). Typing leaves the mode; filters and
   sort are kept, because filtering within favorites is legitimate. The main thread
   only ever holds the id list — favorite products are fetched through the worker
   like any other result, never by keeping a catalog copy.

## State management

Local React state + three hooks (`useSearch`, `useFavorites`, `useRecents`). No
global store.
`lib/storage.mjs` wraps localStorage with a `precio-scanner:` prefix and JSON-safe
read/write. Two keys: `favorites` (product ids, appended on toggle) and `recents`
(query strings). Both are read once at mount and written from a handler, never from
an effect — a mount effect would write the initial state back and clobber data from
an earlier session. Their list math lives in `lib/collections.mjs` so it unit-tests
in Node.

Recent searches need one non-obvious rule. The session debounces at 150 ms, so a slow
typist commits "coca", then "cocac", then "cocacola": storing each commit verbatim
would fill the list with prefixes of a single search. `addRecent` therefore drops any
existing entry that is a **proper prefix** of the new query, and only in that
direction — adding "coca" after "cocacola" keeps both, because the user may have
deliberately searched the shorter term. Dedupe is case-insensitive, the new casing
wins, and the list is capped at 10.

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
| Fuse threshold too loose/strict | Threshold fixed at **0.35** (`searchEngine.mjs`), verified against the real catalog: AC-2 and AC-3 return 10/10 relevant results in the top 10 (`05-acceptance-report.md`). Not yet tuned against a personal list of tricky searches (WU7.1) |
| GH Pages base-path mistakes | `base` set on day one; deploy verified with a blank page first |

## Testing strategy

- Vitest unit tests: worker message handling (search, filters, sort, paging) against
  a small fixture catalog; catalogLoader cache/version logic with a mocked Cache API.
- Normalization + index scripts tested with fixture raw catalogs (valid, truncated,
  corrupt): exit codes, output shape, id stability.
- Manual acceptance checklist per AC-1..AC-7 after each relevant commit, including
  the network-panel cache-hit check and a long-typing responsiveness pass.
