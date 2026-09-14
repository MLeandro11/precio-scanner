# Proposal: Lupa (was "precio-scanner")

> Updated 2026-09-14 to reflect the rebrand and the Phase 1 scope growth landed in the
> `c34d0e7` merge (TypeScript + router + shopping list + EAN scanning). The original
> wording below is kept where it still holds; additions are marked explicitly.

## Problem

A supermarket-style web app loads a full product catalog (~23,230 products) into browser
memory and offers only a basic `filter().includes()` search with per-keystroke server
requests. Users get weak search (typos, missing accents, and reordering break it), no
combined filters, and no way to keep track of products they buy repeatedly. The catalog
data itself is freely accessible client-side (confirmed via heap snapshot: a `useState`
hook holding a 23,230-element array, 100% client-side search verified in offline mode).

## Solution

A free, static, **fully client-side** web app — **Lupa** — whose core engineering goal is
handling the **large catalog entirely in the browser**, with no backend:

1. **Large-catalog client-side architecture** — catalog + search index delivered as
   static pre-built assets, cached in the browser, and owned by a Web Worker so the
   main thread stays responsive.
2. **Smart search** — fuzzy matching (Fuse.js) over a build-time pre-generated index,
   with typo tolerance, combined filters (category, price range), highlight, sorting by
   relevance or price, and **exact EAN / barcode matching** (FR-2.8).
3. **Favorites and search history** — recurring products and recent searches in
   localStorage.
4. **Shopping list by EAN** *(added in the rebrand)* — the product's **EAN** is the stable
   identity; the list stores entries with quantity and an optional price alert, persisted
   in localStorage. Multi-store price comparison / price history / alerts are **modelled**
   (`AlmacenPrecio`, `HistorialPrecio`) but not simulated: today there is one store of
   data.
5. **EAN intake** *(added in the rebrand; cross-device in the scanner update)* — camera
   scanning on **any device** (single pure-JS decoder, ZXing) with dedupe/cooldown gating
   when available, plus manual EAN entry (the always-available fallback on
   unsupported/denied contexts), landing on a product detail page with "add to list".

## Target users

The project owner (personal use first): find products fast in a large catalog, keep a
frequent-items list, and (in future) watch EAN prices. Potentially shareable publicly as
a static page.

## Scope

### Phase 1 (this change — original)
- Vite + React static app deployed to GitHub Pages.
- Data pipeline: raw catalog JSON → minimal normalized catalog JSON with tests
  (`id, nombre, marca, categoria, barcode, precio`).
- Build-time generated Fuse.js index + facet data (categories, brands, price ranges).
- Web Worker that owns the catalog + index; main thread only sends queries and
  receives top-N results.
- Browser-side caching of catalog + index (Cache API, versioned by data hash).
- Combined filters and sorting (relevance, price).
- Favorites and search history (localStorage).

### Delivered on top of Phase 1 (rebrand, `c34d0e7`)
- **TypeScript strict** migration of app, scripts, worker, and tests.
- **React Router v7** routed pages: Home `/`, Search `/buscar`, Scan `/escanear`,
  Product `/producto/:ean`, History `/historial/:ean`, List `/lista`, placeholders for
  `/alertas` and `/perfil`.
- **Shopping list by EAN** (`lib/lupa/list.ts`, `useList`, storage key `lupa:lista`):
  quantities, price alert flag, "barcode image" view.
- **Camera scanner** (`useBarcodeScanner` + `lib/lupa/scan.ts`) with manual EAN fallback.
- In-house **design system** (`docs/design-system.md`, tokens + `ui/Button, Input, Sheet,
  Skeleton`, `Barcode`, `Brand`), `lucide-react` icons.
- `useResolveEans` resolves persisted list EANs to catalog products through the worker,
  keeping the main thread free of the product array.

### Phase 2 (separate future change)
- Live multi-store price comparison (models exist: `AlmacenPrecio`).
- Daily catalog updater (GitHub Actions cron) + price history archive per EAN.
- Price alerts (models exist: `HistorialPrecio`, `ListaItem.alerta`; the notification
  only arrives with real multi-store/history data).

## Non-goals

- No unit-of-measure parsing or price-per-unit comparison (explicitly cut: the value of
  this project is fast client-side search over a big catalog and EAN-based lists, not
  unit math).
- No backend server, no accounts, no auth.
- No multi-store price comparison in Phase 1 (modelled, not simulated; needs real data).
- No fabricated price history or simulated alerts — the current single-store dataset
  cannot source them.
- No scraping of per-product pages; a single daily bulk extraction only.
- No mobile native app.

## Constraints

- Data source: one bulk catalog extraction from the target app (request already
  identified via DevTools). Extraction runs at most once per day.
- Hosting: GitHub Pages (static, zero cost) — everything must work from static files.
- Normalized catalog JSON must stay small (~1–3 MB raw, well under when gzipped);
  the Fuse index is generated at build time, never assembled in the browser.
- Legal/ethical: low-frequency extraction of publicly served bulk data, personal use.
- Runtime: Node ≥ 23.6 for the `.ts` CLI scripts (type stripping); `tsconfig` uses
  `strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`.

## Success criteria

- Search finds products despite typos, missing accents, or reordered terms
  (e.g., "serenisma" → "La Serenísima", "cocacola" → "Coca-Cola"), and matches an EAN
  code exactly with no fuzzy false positives.
- First meaningful paint with searchable catalog under ~3 s on a normal connection;
  repeat visits use the cached catalog and boot near-instantly.
- Typing/filtering never blocks the UI thread: search runs in a Web Worker and
  results are rendered as a bounded top-N list.
- A shopping list persists across reloads by EAN identity, and an EAN entered or scanned
  resolves to a product and can be added to the list.
- Deploy pipeline: `git push` → live site in under 5 minutes, no manual steps.