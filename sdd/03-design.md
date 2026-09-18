# Design: Lupa (was precio-scanner, Phase 1)

> Reconciled 2026-09-12 against commit `a75ba32`; updated 2026-09-14 for the **Lupa
> rebrand** (`c34d0e7`): the codebase is now **TypeScript strict** (`.ts`/`.tsx`), the app
> is routed with `react-router-dom` v7, and the shopping-list / scanner / product-detail
> layers (`lib/lupa/*`, pages, design system) were added. The worker-owns-catalog core and
> the FR-2.8 barcode path are unchanged by the rebrand.

## Architecture overview

```
[raw catalog.json]                      (manual extraction, DevTools)
        │  scripts/normalize-catalog.ts  (Node, tested)
        ▼
[public/data/catalogo.json]  (minimal records)
        ├─► build-time Fuse index   → [catalogo-index.json]
        └─► build-time facet data   → [catalogo-facets.json]
                     │
                     ▼
      Vite + React 19 + TS strict SPA (static, GH Pages, base /precio-scanner/)
      ├─ App.tsx                (boot catalog into worker + CatalogContext + <Routes>)
      ├─ workers/catalog.worker.ts   (owns catalog + index: search, filters, sort)
      ├─ lib/                   catalogLoader, workerClient, storage, searchEngine/Session,
      │                         collections, lupa/{list,scan}, types
      ├─ hooks/                 useSearch, useFavorites, useRecents, useList,
      │                         useResolveEans, useBarcodeScanner
      ├─ pages/                 Home, Search, Scan, Product, History, List, Placeholder
      ├─ layout/AppLayout.tsx   (bottom nav)
      └─ components/            SearchBar, FilterBar, SortSelect, ProductList, ProductCard,
                                HighlightedName, Barcode, Brand, ui/{Button,Input,Sheet,Skeleton}
```

Core decision (unchanged): **the worker owns the heavy data**. The main thread never holds
the 20k+ product array; it holds only the visible page, small facets, and the persisted
**EAN id list**. This keeps typing, scrolling, and filtering responsive — the exact
failure mode of the original app.

## Directory layout

```
public/data/          catalogo.json, catalogo-index.json, catalogo-facets.json
scripts/              normalize-catalog.ts, generate-index.ts (+ *.test.ts; Node, run .ts via type stripping)
src/
  workers/catalog.worker.ts
  lib/                catalogLoader.ts, workerClient.ts, storage.ts, searchEngine.ts,
                      searchSession.ts, collections.ts, stableId.ts, types.ts,
                      lupa/{list.ts, scan.ts}     (pure list + scan-gate math)
  hooks/              useSearch, useFavorites, useRecents, useList, useResolveEans, useBarcodeScanner
  components/         SearchBar, FilterBar, SortSelect, ProductList, ProductCard, HighlightedName,
                      Barcode, Brand;  ui/{Button, Input, Sheet, Skeleton}
  layout/AppLayout.tsx;  pages/{Home,Search,Scan,Product,History,List,Placeholder}Page.tsx
```

## Data model

```ts
type Producto = {
  id: string;        // raw extraction uuid; stableId(nombre) fallback
  nombre: string;
  marca: string;     // always '' for now (source has no brand field)
  categoria: string;
  barcode: string;   // EAN/UPC, '' when the source row has none; exact-match key (FR-2.8)
  precio: number;    // integer minor currency units
};
```

Single source of truth in `src/lib/types.ts`. Deliberately minimal. The shopping list adds
its own EAN-first model in `lib/lupa/list.ts`:

```ts
type ListaItem = { ean: string; cantidad: number; alerta: boolean; nombre?: string; productoId?: string }
// + future-only models: AlmacenPrecio { almacen, precio, fecha }, HistorialPrecio { ean, puntos[] }
```

Produced **by EAN** — the stable identity across stores — with `normalizeEan` stripping
`\s\-._` and uppercasing. Multi-store/history models exist so future wiring needs no shape
change; nothing simulates that data (single store today).

## Data pipeline (build time)

1. `scripts/normalize-catalog.ts`: raw extraction → `catalogo.json`. Ids from the raw
   extraction (source-stable uuids; `stableId` fallback). Excludes null/zero prices
   (counted, reported); `enTienda` is deliberately **not** an exclusion criterion (it is
   `true` for only 8 of 23,230 records, so it does not mean "available"). Fail-loud, input
   side: <20,000 input, missing nombre, non-numeric precio. Fail-loud, output side (checked
   before the write, no file emitted): duplicate ids, record conservation, and >50% of the
   input excluded.
2. `scripts/generate-index.ts`: `catalogo.json` →
   `catalogo-index.json` (Fuse pre-index over `nombre` + `categoria`) and
   `catalogo-facets.json` (`{ version, categories, brands, priceBounds }`; `brands` empty
   until the source provides brand data).
3. A `version` content hash keys the client cache (FR-4.2) so a new dataset invalidates the
   browser cache automatically.

Both scripts are pure Node `.ts`, tested with fixture catalogs (valid, truncated, corrupt).

## Large-catalog client handling

### Loading and caching (`lib/catalogLoader.ts`)
- Parallel `fetch` of the three data files, each stored in the Cache API under a key that
  includes the data version.
- On boot: cache hit → hydrate the worker from cached bytes (no network); miss → fetch
  with progress indication, then store. Facets is always refetched (it carries the
  version).
- First paint is never blocked: skeleton immediately, catalog hydrates in background.

### Worker (`workers/catalog.worker.ts`)
- Receives catalog + index, constructs the single `Fuse` instance, answers typed messages
  `{ type: 'query', query, ids, categoria, priceMin, priceMax, sort, limit, offset }`
  (`ids` = favorites-mode filter; null/empty means no restriction).
- Returns `{ results: Product[] (≤50), total: number }`; `total` drives "load more"
  without shipping the whole match set.
- One request in flight; new input cancels (or its response is discarded by the generation
  counter on the main thread).

### Rendering
Top-N list (50) + "load more". No virtualization library: a bounded list satisfies the
responsiveness requirement with zero extra dependencies.

## Routing and state

`react-router-dom` v7 with `basename = import.meta.env.BASE_URL` (`/precio-scanner/`).
Routes: Home `/`, Search `/buscar`, Scan `/escanear`, Product `/producto/:ean`, History
`/historial/:ean`, List `/lista`, placeholders `/alertas` and `/perfil`, redirect fallback.

`App.tsx` boots the catalog once into the worker and exposes `CatalogContext` (the worker
client + small facets) to every route. `CatalogContext` never holds the product array.

State: local React state + hooks (`useSearch`, `useFavorites`, `useRecents`, `useList`,
`useResolveEans`, `useBarcodeScanner`). No global store.

- `lib/storage.ts` wraps localStorage with a `precio-scanner:` prefix and JSON-safe
  read/write; keys: `favorites` (ids), `recents` (queries). The shopping list uses its own
  key **`lupa:lista`** (same storage wrapper). Collections math lives in
  `lib/collections.ts` and `lib/lupa/list.ts` so it unit-tests in Node.
- List math is EAN-keyed and pure (`addItem` increments duplicates, `setCantidad(0)`
  removes). EANs resolve to products on demand through the worker (`useResolveEans`), so
  the main thread holds only ids.

## Search pipeline

1. Boot: `catalogLoader` hydrates worker (cache or network) → skeleton until ready.
2. `useSearch(query)`: debounce 150 ms → post to worker → results replace the current
   page; generation counter drops stale responses. A debounce commit of a non-blank query
   reports once through `onQueryCommit` so the caller persists it as a recent search; the
   initial browse, filters, sort and paging are not reported and a failing storage write
   never breaks a run.
3. Highlight via Fuse match positions on `nombre`/`categoria`.
4. Filters/sort ride the same worker message and are applied over the match set.
5. Barcode-like queries (≥6 digits, no letters) short-circuit fuzzy search:
   `searchEngine` builds a `Map<barcode, Product[]>`; an exact hit returns with priority;
   no exact hit falls through to normal search, never to a fuzzy code near-miss (FR-2.8).
6. Favorites mode: `showFavorites(ids)` clears pending debounce, sets `ids` and runs
   immediately; the worker restricts the match set and `total` stays honest. Typing leaves
   the mode; filters/sort are kept.

**Scanner** (`lib/lupa/scan.ts` + `hooks/useBarcodeScanner.ts`): uses a **single pure-JS
decoder — ZXing `BrowserMultiFormatReader`** — so camera scanning works on **any device
with `getUserMedia`** (Safari iOS, Firefox, Chrome/Edge/Android), dropping the previous
Chromium-only `BarcodeDetector` path. Restricted to the EAN/UPC family via decode hints,
throttled (delayBetweenScanAttempts / delayBetweenScanSuccess) so it does not read a
full-res frame on every animation tick. `useBarcodeScanner` reports status
(`unsupported|requesting|active|denied|error`) and the camera stream emits a code on
almost every frame, so `createScanGate` (dedupe + 1500 ms cooldown) turns that firehose
into one signal per distinct code per window. The ScanPage falls back to manual EAN entry
on anything but `active`. The `@zxing/browser` decoder is **lazy-loaded** with the
`/escanear` route so it is not downloaded unless the user opens the scanner.

## Styling

Tailwind v4 (`@tailwindcss/vite`) consuming **in-house design tokens** — see
`docs/design-system.md`. Components use semantic tokens (`bg-surface`, `text-text-primary`,
`--surface`, `--border`, …), never bare hexes. Mobile-first, single column, bottom
navigation, floating outline nav bar.

## Deployment

- `vite.config.ts`: `base: '/precio-scanner/'`.
- `.github/workflows/deploy.yml`: checkout → node 24 → `npm ci` → `npm run build` →
  `upload-pages-artifact` → `deploy-pages`. Trigger: push to `main`.
- Pages source set to "GitHub Actions"; verified live (`AC-6`).

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Worker + Fuse complexity (serialization bugs) | Tiny typed message schema; Vitest tests for the worker client with a mocked worker |
| Stale worker responses race with fast typing | Generation counter; only latest generation renders |
| Cache invalidation after data updates | Versioned cache keys from build-time data hash; stale entries never read |
| Large JSON hurts first load | Minimal records, gzip via Pages, progress skeleton; index pre-generated (never built in-browser) |
| Catalog becomes stale | Accepted for Phase 1; daily updater is Phase 2 |
| Raw data has no brand field | `marca` kept as `''`; no brand filter/index in Phase 1 |
| Zero-price noise | Excluded at normalize time with reported counts. `enTienda` is **not** an exclusion criterion (FR-1.3) |
| Fuse threshold too loose/strict | Fixed at **0.35** (`searchEngine.ts`). **Tuned** in WU7.1 by `scripts/tune-threshold.ts` against the real catalog: 6 queries × thresholds 0.25–0.40. Rank and precision@10 are **flat across the whole range** (`serenisma`/`cocacola` 10/10, `quilmes 1890` 6/10, `zero 1,5` and `yogurt griego` 1/10, `coca 2,5` 0/10), so the threshold does **not** decide ordering — it only sets tail volume. `0.35→0.40` multiplies total matches **×7.84** (106→831), so 0.35 is the tightest value below the flood cliff. The run's real finding is a defect no threshold can reach: `engine.fuse.search(q)` passes the raw string as **one** fuzzy pattern, so `coca 2,5` is not "coca AND 2,5" and the correct catalog entries never surface. Tracked as 7.7 |
| GH Pages base-path mistakes | `base` set on day one; router `basename` follows `BASE_URL`; deploy verified live |
| Scanner is Chromium-only | Replaced with a single pure-JS decoder (ZXing) that works on any device with `getUserMedia`; manual EAN entry remains as the always-available fallback (FR-9.2) |
| Persisted EANs drift from catalog | `useResolveEans` resolves lazily through the worker; barcode-less products fall back to id |
| Multi-store / history / alerts have no data | Modelled (`AlmacenPrecio`, `HistorialPrecio`) but never simulated; placeholders are honest |

## Testing strategy

- Vitest unit tests: worker message handling (search, filters, sort, paging) against a
  small fixture catalog; catalogLoader cache/version logic with a mocked Cache API;
  `lib/lupa/list.test.ts` (list math) and `lib/lupa/scan.test.ts` (scan gate).
- Normalization + index scripts tested with fixture raw catalogs (valid, truncated,
  corrupt): exit codes, output shape, id stability.
- `npm test` → 11 files, 97 tests; `npm run typecheck` clean.
- Manual/automated acceptance per AC-1..AC-8 (`scripts/acceptance.ts` → 16 checks),
  including the network-panel cache-hit check and a long-typing responsiveness pass.