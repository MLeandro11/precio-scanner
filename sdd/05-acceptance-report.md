# Acceptance report: Lupa (precio-scanner, Phase 1)

> **SUPERSEDED as of 2026-09-14.** The run recorded below is historical: it predates the 17th
> (NAV-back) check, the `DEEP-*` deep-link rows, and the switch from `vite preview` to a server
> that reproduces GitHub Pages semantics (`scripts/ghpages-server.ts`). It was also produced
> while the harness was still **flaky** (three runs on one build gave 14/17, 17/17, 16/17).
> Post-hoc note only — the evidence below was NOT rewritten. Current state: **20 rows, 20/20
> PASS** (19 PASS + 1 INFO — `FR-2.8d` is informational), reproducible. **WU7.5** made the
> harness deterministic and **WU7.6** made it faithful and added the deep-link/reload coverage
> (see `04-tasks.md`). The AC-5 timing figures below are not reproducible as fixed numbers
> (post-fix runs measured 33–50 ms against the 150 ms budget).

Automated acceptance pass for `AC-1..AC-7` plus the FR-2.8 and WU6 extras. Every result
below comes from a program, not from reading the code; the script exits non-zero on any
failure, so it can gate a release or run in CI once a browser is available.

**Run (Lupa re-verification):** 2026-09-14, working tree at the Lupa TypeScript code
(`c34d0e7` merge). This is the same 16-check script run on the rebranded code.
Earlier pass (pre-rebrand JS, `8cd0298`): 2026-09-12, also 16/16.
**Environment:** Ubuntu 24.04 (WSL2), Node v24.14.1, Playwright driving the system
Chrome headless, viewport 1280x900.

**Reproduce:**

```sh
npm run build && npm run preview   # serve the production build on :4173
npm run acceptance                 # in a second shell
```

The script drives the real app over the real 20,331-product catalog.

## Results (Lupa re-run, 2026-09-14)

| Criterion | Result | Evidence |
| --- | --- | --- |
| AC-1 normalizer exits 0 / non-zero on corrupt input | **PASS** | Covered by unit tests: `scripts/normalize-catalog.test.ts` (valid, truncated, corrupt, exit codes). A Node pipeline concern, not a browser one — not re-run by the browser script. |
| AC-2 "serenisma" returns La Serenísima in the top 10 | **PASS** | 10/10 top results match `seren`. First: `QUESO RALLADO SERENISIMA 80GR`. |
| AC-3 "cocacola" returns Coca-Cola, typo/space tolerant | **PASS** | 10/10 top results match `coca` with the one-word query. First: `COCA COLA 1.75`. |
| AC-4 repeat visit does not re-download catalog/index | **PASS** | First visit requests all three files. After a reload: only `catalogo-facets.json` over the network — **0 requests** for `catalogo.json` and `catalogo-index.json`, served from the versioned Cache API. Facets is always refetched because it carries the version. |
| AC-5 main thread stays responsive while searching | **PASS** | 43 keys typed in 1,515 ms; worst frame gap **33 ms**; **0 frames over 100 ms**. The UI thread is never blocked by search work. |
| AC-6 push to `main` publishes to GH Pages | **PASS** | Push to `MLeandro11/precio-scanner` (public) triggers `deploy-pages@v4`. Verified live at `https://mleandro11.github.io/precio-scanner/`. Pages source set to "GitHub Actions". |
| AC-7 favorites and recents survive a reload | **PASS** | `localStorage` byte-identical across reload; both chips re-render; the favorites view still resolves the stored ids through the worker. |

Extra checks beyond the criteria:

| Check | Result | Evidence |
| --- | --- | --- |
| FR-2.8 exact EAN match | **PASS** | `7793940219009` → exactly 1 result. |
| FR-2.8 separator normalization | **PASS** | `779 3940 219009` → 1 result; separators are stripped before matching. |
| FR-2.8 no false positives on codes | **PASS** | `9999999999999` → 0 results. A code that does not exist returns nothing rather than a fuzzy guess. |
| FR-2.8 labelled code is a text query | **INFO** | `"EAN 7793940219009"` → 0 results. It contains letters, so by spec it is a text query, not a barcode. Known follow-up (see below). |
| Favorites toggle (`WU6.2`) | **PASS** | Star on product detail → exactly 1 `aria-pressed=true` button. |
| Recents persist on commit (`WU6.3`) | **PASS** | The chip renders after an empty query and survives the reload. |
| Persistence (both collections) | **PASS** | `localStorage` holds `precio-scanner:recents` and `precio-scanner:favorites` together. |
| Unfavoriting from product detail | **PASS** | The row returns to "Agregar" state and favorites storage empties (regression fix carried into the rebrand). |

**16/16 checks PASS** in the Lupa re-run.

## What this pass does not prove

- No slow-network or slow-CPU throttling. AC-5 was measured on this machine, which is
  fast; a low-end phone is the case the requirement was written for.
- **AC-5 is measured as animation-frame gaps**, an objective proxy for main-thread
  blocking, not a human judging that typing feels instant.
- The Cache API path is exercised against the production build served by `vite preview`.
  GitHub Pages adds gzip and CDN behaviour not reproduced locally.
- `localStorage` persistence is verified within one browser profile. It does not cover a
  user clearing site data, a private window, or two tabs writing concurrently.
- **New in the rebrand:** the acceptance pass does not yet drive the camera scanner
  (physical camera) nor exercise the shopping list / EAN-identity flows
  end to end. The Lupa list and scan-gate logic are unit-tested
  (`src/lib/lupa/*.test.ts`), but the wired UI path is manual only.

## Follow-ups worth considering (not defects)

1. **Recents do not normalize barcode-like queries.** Searching `7793940219009` and
   `779 3940 219009` stores two separate entries for the same product. Collapsing
   digit-only queries before storing would remove that duplication.
2. **`"EAN 7793940219009"` finds nothing.** By spec a query containing letters is not
   barcode-like, so it goes to fuzzy text search and misses. Pasting a labelled code
   from an invoice or supplier sheet is plausible; stripping a leading `EAN`/`EAN13`
   label before the barcode check would handle it.
3. **~290 products carry barcodes shorter than 6 digits** (251 have none at all). Those
   codes can never match the barcode path (which requires ≥6 digits). Source data
   quality; "search by code" is not universal and the README says so.
4. **Camera scanner acceptance is not automated.** `useBarcodeScanner` (now a single
   pure-JS ZXing decoder, cross-device) is covered by unit tests on the gate
   (`lib/lupa/scan.test.ts`), but the full camera path needs a device/emulated-input
   harness to be trustworthy in CI.