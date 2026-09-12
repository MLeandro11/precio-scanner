# precio-scanner

Client-side supermarket catalog search app. Static Vite + React SPA with fuzzy
search over a large (~23k products) catalog — no backend, fully static, deployed
to GitHub Pages.

## Setup

```sh
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

## Deployment

Every push to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`. No manual steps.

## Data pipeline

Raw catalog extraction goes to `raw-catalog.json` (repo root, gitignored —
never commit it). Then:

```sh
npm run normalize        # raw-catalog.json → public/data/catalogo.json
npm run generate-index   # → catalogo-index.json + catalogo-facets.json
```

Regenerate after every fresh extraction; `catalogo-facets.json` carries a
content hash (`version`) used for client-side cache invalidation.

## Testing

```sh
npm test            # vitest: pure logic (search engine, session, loader, pipeline, collections)
npm run build && npm run preview   # then, in a second shell:
npm run acceptance  # real browser: AC-2..AC-5, AC-7, barcode lookup
```

`npm run acceptance` needs Playwright plus a browser. It uses the system Chrome when
one is present (`CHROME_PATH` overrides it) and otherwise falls back to Playwright's own
download. It exits non-zero on any failure. Results are recorded in
`sdd/05-acceptance-report.md`.

## Known limitations

- **Partial catalog dates.** A fresh extraction is a manual DevTools step; the data
  in `public/data/` is as old as the last regeneration. Prices drift.
- **Search by code is not universal.** 251 products have no barcode and ~290 carry fewer
  than 6 digits. A code query needs at least 6 digits, so those can never be found by
  code — only by name.
- **A labelled code is not recognised.** `EAN 7793940219009` contains letters, so it is
  treated as a text query and finds nothing. Only the bare digits work.
- **Recents do not normalise codes.** The same product searched as `7793940219009` and
  `779 3940 219009` is stored twice.
- **Favorites live in one browser profile.** `localStorage` is per device and per
  browser; clearing site data removes them, and two tabs writing at once can race.
- **Single store.** One extraction, one price per product. No multi-store comparison,
  no price history (Phase 2).
- **No unit-price comparison** by design — the source has no measure data (Phase 2).
- **The deploy path is untested.** No git remote is configured yet, so nothing has
  actually been published to GitHub Pages.

## Status

Phase 1 implemented, including favorites and recent-search persistence. Search, filters,
sorting, and barcode (EAN) lookup run over the real 20,331-product catalog.

- Unit tests: 78 passing across 9 files (`npm test`).
- Acceptance pass: 16/16 checks pass in a real browser (`npm run acceptance`).
- **AC-6 is not verified**: there is no git remote, so the GitHub Pages deploy has never
  run.

Per-item status with evidence lives in `sdd/04-tasks.md`, and the acceptance results in
`sdd/05-acceptance-report.md`.
