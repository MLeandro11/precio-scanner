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
- `.github/workflows/deploy.yml` runs two jobs. **`verify`**: `npm ci` → `npm run typecheck` →
  `npm test` → regenerate the search assets and fail if `public/data/` is stale. **`deploy`**
  (`needs: verify`): `npm run build` → `upload-pages-artifact` → `deploy-pages`. Trigger: push
  to `main`. A red `verify` blocks the release instead of publishing it.
- Pages source set to "GitHub Actions"; verified live (`AC-6`).

## PWA: service worker and offline boot (FR-11, WU9)

### Decision (WU9.1)

`vite-plugin-pwa` v1.3.0, `generateSW` mode (Workbox 7), `registerType: 'autoUpdate'`.

Taken over a hand-written `sw.js` emitted by `scripts/postbuild.ts`. The repo's
minimal-dependency stance made the hand-written route genuinely attractive, but the work the
plugin does is precisely the work that is easy to get subtly wrong: an asset manifest keyed to
Vite's content hashes, a versioned precache with old-cache cleanup, and a navigation fallback
that respects `base`. Hand-rolling it would mean reimplementing all of that and owning its
bugs. The cost is build-time only — ~1.6 MB of `node_modules`, and nothing shipped to the
browser beyond Workbox's small runtime chunk.

### Update policy

`autoUpdate` (`skipWaiting` + `clientsClaim`). FR-11.3 asks that a new deploy reach a
returning visitor without clearing site data, and this is what delivers it. The known cost is
the classic mismatch where a page still open on the old bundle tries to fetch a chunk the new
deploy replaced.

**How long the old version lingers — measured, not assumed.** The navigation that triggers the
worker's update check is answered by the worker still active at that moment, so the new
precache normally lands on the *next* navigation. Three deploy cycles against a live server
took **2, 1, 2** navigations; the lone 1 was a cycle where the browser's own background update
check had already run before the navigation. Two is the bound a criterion can assert, and it is
what `02-spec.md` AC-10 now says. The reason not to switch the document to a network-first
strategy to get to one: it would trade an instant cache-first boot for one round trip on every
navigation, to shorten a window that is already bounded and that FR-11.3 never constrained.

### What is precached, and what deliberately is not

13 entries / ~912 KiB: the document, the three JS chunks (including the 467 kB `ScanPage`
chunk, so the scanner works offline the first time it is opened in a store), the CSS, the
icons and the manifest.

`public/data/**` is excluded with `globIgnores`. The catalog (3.4 MB) and index (2.1 MB) are
**not** the service worker's business: `catalogLoader` already caches them under keys keyed by
the catalog's sha256 (FR-4.2), and `catalogo.json` alone exceeds Workbox's 2 MiB per-file
default. Precaching them would double ~5.5 MB of storage and leave the app with two competing
opinions about which copy of the data is current.

`globPatterns` covers build output only (`**/*.{js,css,html}`); the `public/` icons arrive
through `includeAssets`. Listing them in both places precached every one of them twice — the
first build produced 21 entries that were 13 unique files with 7 duplicated pairs.

### The offline boot needed an application fix, not a service worker one

This is the part the service worker does not solve. `catalogo-facets.json` is read before the
heavy files because it carries the data version, and it used to be fetched **network-only** by
design. Offline, that failed the entire boot — so the app held 5.5 MB of perfectly cached data
it could never reach. `catalogLoader` now treats the facets as network-first with the last
known copy as the fallback.

The distinction that matters, and that the tests pin down: a request that **never completed**
is the offline signal and may fall back to cache, while a server that is reached and **answers
badly** (404, or HTML from an SPA fallback) stays fatal. Collapsing the two would let a stale
cached copy hide a deployment where `public/data/` stopped being published.

## Saved lists: opt-in snapshots in Firestore (FR-12, WU10)

### The decision: snapshots, not sync

The requirement (FR-12) already fixes the shape, so the design question was narrower: **where
does the cloud sit relative to the working list?** The rejected alternative was continuous
two-way sync of `lupa:lista`. It loses on three counts:

1. It would make `useList` asynchronous. The hook is a synchronous localStorage adapter today
   (`useList.ts:53,56-61`) with six consumers — `AppLayout` (badge), `HomePage`, `ListPage`,
   `ProductPage`, `ScanPage`, `SearchPage`. Every one would have to grow a loading state.
2. It would need conflict semantics: two devices, last-write-wins, an offline mutation queue
   and a merge rule for quantities. All of that is new, and all of it is the kind of code that
   loses user data quietly.
3. It would make a session mandatory for the core list, degrading the app for anyone who never
   signs in.

With snapshots, **the cloud never touches the hook**. Saving reads `items` and writes a
document; opening a saved list calls the same `add` a product page calls. The working list is
byte-identical before and after every save — which is exactly what AC-11 asserts.

### Document shape

`users/{uid}/lists/{listId}` holding `{ nombre: string, creada: Timestamp, items: ListaItem[] }`,
items embedded.

Embedded and not a subcollection because the numbers are unambiguous: a serialized `ListaItem`
is ~152 bytes, so a 100-item list is ~15 KB — **1.45% of Firestore's 1 MiB document limit**. A
subcollection would add a read per list and buy nothing.

### The lazy loader (`lib/firestoreLists.ts`)

Mirrors `getAuthClient` (`firebaseAuth.ts:26-41`): a module-level memoized promise around the
single dynamic `import('firebase/firestore')`, so the SDK is fetched once and a failure is not
memoized as a success.

**The design note that was wrong, and what the build actually showed.** The first version of this
section claimed the existing chunking already covered Firestore: `manualChunks` funnelled every
`node_modules/firebase` and `@firebase` module into one `firebase` chunk, and
`globIgnores: ['**/firebase-*.js']` excluded it, so Firestore would add "zero precached bytes".
The first half was true and the conclusion was not, and only building it showed why:

- The funnel **merged Firestore into the auth chunk**. `firebase-*.js` went from 46.21 kB gzip to
  **213.04 kB**, so `/perfil` — a route that exists and needs only auth — would have downloaded a
  database client it never uses. "Not precached" is not the same claim as "not paid".
- Fixing it needed a real chunk split. `@firebase/firestore` and `firebase/firestore` now name
  their own `firestore` chunk, and so does `@firebase/webchannel-wrapper` — Firestore's transport,
  which matches the generic `@firebase` test but is never used by auth, and which by itself kept
  `/perfil` at 65.59 kB gzip until it was moved.
- **A new chunk name is exactly the precache trap.** `globIgnores` matches on the chunk name, so a
  `firestore-*.js` chunk matching only `firebase-*` would have quietly joined the precache.
  `globIgnores` now lists both patterns.

Measured after the split (build output, gzip):

| Chunk | Size | Who fetches it |
| --- | --- | --- |
| `firebase-*.js` | 46.78 kB | `/perfil`, and the saved-lists pages |
| `firestore-*.js` | 165.85 kB | **only** the saved-lists pages |
| `firestoreLists-*.js` | 1.78 kB | the saved-lists pages (app code) |

So `/perfil` is back where it started (46.78 against 46.21 kB — noise), and the SDK is still
absent from the precache: 16 entries, 930 KiB, no `firebase-*` and no `firestore-*`.

The **page** chunks are a different matter: `globPatterns: '**/*.{js,css,html}'` precaches
`SavedListsPage-*.js` and `SavedListDetailPage-*.js`, and that is **wanted, not tolerated**.
FR-12.9 requires an already-fetched saved list to open with no network, and precaching the page is
what makes that reachable at all. The cost is ~3.5 kB gzip downloaded by visitors who never open
them.

### The mapper is pure, and no SDK type escapes it

`toDocument(items)` and `fromDocument(id, data)` are pure functions, and `creada` is converted to
an ISO string at that boundary. Two reasons:

- The Firestore calls need a network and a session; the mapping — which is where data actually
  gets dropped — does not. So it is unit-testable in plain Node (AC-14).
- It keeps `firebase/*` types out of React state, so no component depends on the SDK's shape.

### FR-12.4 is structural, not a guard

The feature's **only** mutator is `add`. There is no `restoreAll`, no `clear`, and no code path
that writes the working list wholesale. The read-only detail view renders the saved document and
offers a per-item "agregar". So "opening a saved list cannot destroy unsaved work" is not
enforced by a confirmation dialog — it is enforced by the absence of the operation. AC-12 has
nothing to get wrong because there is nothing to get wrong.

### Stale EANs are already handled by convention (FR-12.6)

`ListPage.tsx:126` already reads `const name = p?.nombre ?? item.nombre ?? item.ean`, and
`useResolveEans` returns `undefined` for an unknown EAN without dropping the entry. The saved
list detail view reuses that exact fallback. FR-12.6 adds no new mechanism — it records an
existing convention and makes it a requirement, which is why AC-13 is cheap.

### Offline, and failing honestly (FR-12.9)

`initializeFirestore` with `persistentLocalCache` (not `getFirestore`) so an already-fetched list
resolves with no network. The page tracks a discriminated state — `loading | ready | error` —
and **must not render "no tenés listas guardadas" for a failed read**. An empty account and an
unreachable backend are different facts and have to look different.

*Open risk:* the persistent cache needs IndexedDB, which some private modes do not provide. The
implementation must not let that turn into a blank page — see the risks table.

### Route and entry point (FR-12.8)

`/guardadas` (save the current list, and list the saved ones) and `/guardadas/:listId` (the
read-only detail). Reached from `/lista`, never the bottom nav: FR-6.3 fixes five slots and
`SCAN-nav44` (`scripts/acceptance.ts:675`) asserts `navTargets.length === 5`.

**`/lista` gets one link, not a "Guardar" button, and that is a measured constraint.** The first
draft of this section put both affordances on `/lista`. It does not survive contact with the SDK:
`useSavedLists` reaches `useAuth`, and `useAuth` calls `getAuthClient()` in a mount effect
(`useAuth.ts:26`). A "Guardar" button there would load the Firebase SDK on every visit to a core
route — and because that chunk sits deliberately outside the precache, it would also hand `/lista`
a new offline failure mode. So `/lista` stays SDK-free and carries a single "Mis listas guardadas"
link, while the save action lives on `/guardadas`, where the session is already loaded. The link is
always present, so it stays reachable with an empty list.

The save control there is disabled when the working list is empty (saving nothing is meaningless)
and stays enabled for a logged-out user, because that is the path that explains why a session is
needed and offers sign-in (FR-12.5) — and it is the one half of FR-12 the acceptance harness can
assert.

### Security rules are versioned here, published by hand (FR-12.7)

`firestore.rules` in the repository is the source of truth: `users/{uid}/lists/{listId}` is
readable and writable only when `request.auth.uid == uid`, with an explicit deny-all catch-all so
a future collection is never open by accident.

**This file does not ship with a push.** There is no `firebase.json` and the deploy pipeline
publishes GH Pages only, so publishing the rules is a manual
`firebase deploy --only firestore:rules`. Recorded because "the rules are in the repo" and "the
rules are live" are different claims, and only the first one is automatic.

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
| Service worker serves a stale shell | `registerType: 'autoUpdate'` plus Workbox's versioned precache and `cleanupOutdatedCaches`, so the previous cache is dropped when the new worker activates (FR-11.3) |
| A service worker hides a routing bug | It sits between the deploy and the user, and it did: no row asserted an HTTP status, and `clientsClaim` means the `DEEP-*` rows may be answered by the worker rather than the host. `HOST-404` closes it from Node, bypassing the worker by construction |
| First visit happens offline, nothing cached | `catalogLoader` fails with a message naming the condition rather than rendering a broken shell (FR-11.4) |
| Offline serves a stale data version indefinitely | The facets fallback only applies when the request cannot complete. Every online boot still refetches them, so a new data build invalidates the versioned keys on the next visit |
| Saved lists quietly grow into a sync feature | The feature's only mutator is `add`; no `restoreAll` or `clear` path exists inside it. AC-12 is asserted over an operation that was never implemented, not over a dialog that might be dismissed |
| A failed saved-list read looks like an empty account | The page keeps `loading`/`ready`/`error` apart and never renders the empty state for a failed read (FR-12.9) |
| Persistent Firestore cache needs IndexedDB, absent in some private modes | The cache is initialized behind a guard with a memory-cache fallback, so a browser without IndexedDB degrades to online-only reads instead of a blank page |
| Firestore rules are versioned but published manually | `firestore.rules` is the source of truth and the manual publish step is documented; AC-15 is explicitly marked out-of-band rather than implied to be automated |
| A saved snapshot outlives the catalog it came from | The stored `nombre` is the fallback label and unresolvable entries are still rendered (FR-12.6, AC-13) — the existing `ListPage` convention, reused rather than reinvented |
| The saved-lists page chunk joins the precache | Wanted: FR-12.9 needs that page offline. The SDK chunk stays excluded by the existing `globIgnores`, so the heavy part still loads on demand |

## Testing strategy

- Vitest unit tests: worker message handling (search, filters, sort, paging) against a
  small fixture catalog; catalogLoader cache/version logic with a mocked Cache API;
  `lib/lupa/list.test.ts` (list math) and `lib/lupa/scan.test.ts` (scan gate).
- Normalization + index scripts tested with fixture raw catalogs (valid, truncated,
  corrupt): exit codes, output shape, id stability.
- `npm test` → 11 files, 97 tests; `npm run typecheck` clean.
- **Saved lists (FR-12).** The pure mapper is unit-tested in plain Node (AC-14), the draft
  transitions are tested at the state level, and the acceptance harness covers the **logged-out**
  contract only — it has no credentials and must not have any. AC-15 (cross-account privacy) is
  verified by the rules plus a manual two-account probe; the spec records that seam instead of
  implying automated coverage.
- Manual/automated acceptance per AC-1..AC-8 (`scripts/acceptance.ts` → 16 checks),
  including the network-panel cache-hit check and a long-typing responsiveness pass.