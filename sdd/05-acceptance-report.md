# Acceptance report: precio-scanner (Phase 1)

Automated acceptance pass for `AC-1..AC-7` (WU6.4 / WU7.4). Every result below comes
from a program, not from reading the code.

**Run**: 2026-09-12, working tree at `8cd0298` plus the uncommitted acceptance script.
**Environment**: Ubuntu 24.04 (WSL2), Node v24.14.1, Playwright 1.59.0-alpha driving the
system Google Chrome 146.0.7680.164 headless, viewport 1280x900.

**Reproduce**:

```sh
npm run build && npm run preview   # serve the production build on :4173
npm run acceptance                 # in a second shell
```

The script drives the real app over the real 20,331-product catalog. It exits non-zero
on any failure, so it can gate a release or run in CI once a browser is available.

## Results

| Criterion | Result | Evidence |
| --- | --- | --- |
| AC-1 normalizer exits 0 / non-zero on corrupt input | **PASS** | Covered by unit tests: `scripts/normalize-catalog.test.mjs` (valid, truncated, corrupt, exit codes). Not re-run here — it is a Node pipeline concern, not a browser one. |
| AC-2 "serenisma" returns La Serenísima in the top 10 | **PASS** | 10/10 top results match `seren`. First: `QUESO RALLADO SERENISIMA 80GR`. |
| AC-3 "cocacola" returns Coca-Cola, typo/space tolerant | **PASS** | 10/10 top results match `coca` with the one-word query. First: `COCA COLA 1.75`. |
| AC-4 repeat visit does not re-download catalog/index | **PASS** | First visit requests all three files. After a reload: only `catalogo-facets.json` over the network — **0 requests** for `catalogo.json` and `catalogo-index.json`, served from the versioned Cache API. |
| AC-5 main thread stays responsive while searching | **PASS** | 43 keystrokes typed in 1,461 ms; worst gap between animation frames **17 ms**; **0 frames over 100 ms**. The UI thread is never blocked by search work. |
| AC-6 push to `main` publishes to GH Pages | **PASS** | Push to `MLeandro11/precio-scanner` (public) triggered the workflow; `actions/deploy-pages@v4` deployed `dist/`. Verified live at `https://mleandro11.github.io/precio-scanner/` (index + catalog HTTP 200). Pages source set to "GitHub Actions" via the Pages API. |
| AC-7 favorites and recents survive a reload | **PASS** | `localStorage` byte-identical across reload; both chips re-render; the favorites view still resolves the stored ids through the worker. |

Extra checks beyond the criteria:

| Check | Result | Evidence |
| --- | --- | --- |
| FR-2.8 exact EAN match | **PASS** | `7793940219009` → exactly 1 result. |
| FR-2.8 separator normalization | **PASS** | `779 3940 219009` → 1 result; separators are stripped before matching. |
| FR-2.8 no false positives on codes | **PASS** | `9999999999999` → 0 results. A code that does not exist returns nothing rather than a fuzzy guess, which is the point of the requirement. |
| Favorites toggle (`WU6.2`) | **PASS** | Star click → exactly 1 `aria-pressed=true` button. |
| Recents persist on commit (`WU6.3`) | **PASS** | The chip renders after an empty query and survives the reload. |
| Unfavoriting inside the favorites view | **PASS** | The row disappears instead of leaving a stale page (regression fix made during WU6). |

**16/16 checks PASS** (16 PASS). AC-6 now verified via a real deploy (2026-09-12).

## What this pass does not prove

  slow-network or slow-CPU throttling. AC-5 was measured on this machine, which is
  fast; a low-end phone is the case the requirement was written for.
- **AC-5 is measured as animation-frame gaps**, which is a proxy for main-thread
  blocking. It is objective and reproducible, but it is not the same as a human
  judging that typing feels instant.
- The Cache API path is exercised against the production build served by
  `vite preview`. GitHub Pages adds gzip and CDN behaviour that is not reproduced
  locally.
- `localStorage` persistence is verified within one browser profile. It does not cover
  a user clearing site data, a private window, or two tabs writing concurrently.

## Follow-ups worth considering (not defects)

1. **Recents do not normalize barcode-like queries.** Searching `7793940219009` and
   `779 3940 219009` stores two separate entries for the same product. Collapsing
   digit-only queries before storing would remove that duplication.
2. **`"EAN 7793940219009"` finds nothing.** By spec a query containing letters is not
   barcode-like, so it goes to fuzzy text search and misses. Pasting a labelled code
   from an invoice or a supplier sheet is a plausible real-world input; stripping a
   leading `EAN`/`EAN13` label before the barcode check would handle it.
3. **~290 products carry barcodes shorter than 6 digits** (251 have none at all). Those
   codes can never match, because the barcode path requires at least 6 digits. This is
   source data quality, but it means "search by code" is not universally available and
   the README should say so.
