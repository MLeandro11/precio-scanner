# Proposal: precio-scanner

## Problem

A supermarket-style web app loads a full product catalog (~23,230 products) into browser
memory and offers only a basic `filter().includes()` search with per-keystroke server
requests. Users get weak search (typos, missing accents, and reordering break it), no
combined filters, and no way to keep track of products they buy repeatedly. The catalog
data itself is freely accessible client-side (confirmed via heap snapshot: a `useState`
hook holding a 23,230-element array, 100% client-side search verified in offline mode).

## Solution

A free, static, **fully client-side** web app ("precio-scanner") whose core engineering
goal is handling the **large catalog entirely in the browser**, with no backend:

1. **Large-catalog client-side architecture** — catalog + search index delivered as
   static pre-built assets, cached in the browser, and owned by a Web Worker so the
   main thread stays responsive.
2. **Smart search** — fuzzy matching (Fuse.js) over a build-time pre-generated index,
   with typo tolerance, combined filters (category, brand, price range), highlight,
   and sorting by relevance or price.
3. **Favorites and search history** — recurring products and recent searches in
   localStorage.

## Target users

The project owner (personal use first): find products fast in a large catalog and keep
a personal list of frequent items. Potentially shareable publicly as a static page.

## Scope

### Phase 1 (this change)
- Vite + React static app deployed to GitHub Pages.
- Data pipeline: raw catalog JSON → minimal normalized catalog JSON with tests
  (`id, nombre, marca, categoria, precio` — nothing more).
- Build-time generated Fuse.js index + facet data (categories, brands, price ranges).
- Web Worker that owns the catalog + index; main thread only sends queries and
  receives top-N results.
- Browser-side caching of catalog + index (Cache API, versioned by data hash) so the
  full download happens once.
- Combined filters and sorting (relevance, price).
- Favorites and search history (localStorage).

### Phase 2 (separate future change)
- Shopping list panel with totals.
- Daily catalog updater (GitHub Actions cron) + price history archive.

## Non-goals

- No unit-of-measure parsing or price-per-unit comparison (explicitly cut: the value
  of this project is fast client-side search over a big catalog, not unit math).
- No backend server, no accounts, no auth.
- No multi-store comparison (future idea, not this project).
- No scraping of per-product pages; a single daily bulk extraction only.
- No mobile native app.

## Constraints

- Data source: one bulk catalog extraction from the target app (request already
  identified via DevTools). Extraction runs at most once per day.
- Hosting: GitHub Pages (static, zero cost) — everything must work from static files.
- Normalized catalog JSON must stay small (~1–3 MB raw, well under when gzipped);
  the Fuse index is generated at build time, never assembled in the browser.
- Legal/ethical: low-frequency extraction of publicly served bulk data, personal use.

## Success criteria

- Search finds products despite typos, missing accents, or reordered terms
  (e.g., "serenisma" → "La Serenísima", "cocacola" → "Coca-Cola").
- First meaningful paint with searchable catalog under ~3 s on a normal connection;
  repeat visits use the cached catalog and boot near-instantly.
- Typing/filtering never blocks the UI thread: search runs in a Web Worker and
  results are rendered as a bounded top-N list.
- Deploy pipeline: `git push` → live site in under 5 minutes, no manual steps.
