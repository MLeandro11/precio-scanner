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

## Status

Phase 1 skeleton. Planning artifacts live in `sdd/`.
