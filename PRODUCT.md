# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner and people close to them — family and friends. Confirmed directly, and it supersedes
the vaguer "personal use first / potentially shareable publicly" of `sdd/01-proposal.md:44`. This
is not a public product, and no audience research backs it.

The situation of use is physical and already written down, `docs/design-system.md` §0: **"a phone
in one hand, often mid-task (in a store, comparing prices), thumb-reach zone"**. The phone is the
primary device; a wide desktop layout is not a target.

## Product Purpose

Lupa answers three confirmed jobs, on a phone, in a store:

1. **Find a product fast** in a large catalog (~20,331 items, 98.8% with a barcode) when the shelf
   or the store's own search does not help.
2. **Build the shopping list** and keep it at hand while shopping.
3. **Follow whether a price changed** since last time. This is the product's stated future
   identity, and it currently has no data behind it — see Capabilities and Constraints.

Its engineering core is handling that whole catalog in the browser with no server
(`sdd/01-proposal.md:17-23`).

## Positioning

The repo states a **mechanism**, not a competitive claim, and the mechanism is the honest part of
the position:

- The catalog and its search index ship as static pre-built assets, are cached in the browser, and
  are owned by a Web Worker so the main thread stays responsive.
- The **EAN is the stable identity**: the same code keys the list entry, the product photo, and
  any future price history.

No comparison against the store's shelf labels, against other price apps, or against a spreadsheet
is written anywhere, and none was volunteered. That absence is recorded rather than filled with an
invented differentiator.

## Operating Context

- **One store today.** `README.md:7` — "Hoy el catálogo es de una sola tienda". Multi-store is
  modelled in `AlmacenPrecio` (`src/lib/lupa/list.ts`) and deliberately not implemented;
  `/perfil` shows `Tiendas: 1`.
- **Prices** come from the Argentine public dataset **Precios Claros**, through one bulk extraction
  at most once a day (`raw-catalog.json`, gitignored), normalized into `public/data/catalogo.json`
  (3.4 MB) plus a generated index (2.1 MB).
- **Photos** come from the Precios Claros image CDN keyed by EAN
  (`https://imagenes.preciosclaros.gob.ar/productos/{ean}.jpg`, `src/lib/images.ts`), with a
  fallback when the code is too short to form a URL.
- **Used on a phone with poor signal, inside a store.** After one online visit the app must boot,
  load its catalog and search with no network at all (`sdd/02-spec.md` FR-11).
- **Spanish, Argentina** (`lang: 'es-AR'`), numbers and prices formatted `es-AR`.
- **Hosted on GitHub Pages** under `/precio-scanner/`. The old product name survives in the
  repository name, the package name and the deploy path — not in the product.
- The specific store or chain the catalog belongs to **has not been recorded anywhere**.

## Capabilities and Constraints

Working today (status table at `README.md:28-36`): fuzzy name search that survives typos, accents
and reordering ("serenisma" → "La Serenísima"); exact EAN/barcode lookup with no fuzzy false
positives; category and price filters; sort by relevance or price; recent searches; favorites;
product detail by EAN; camera scanning with a manual EAN fallback; a barcode view of the list;
"Mi lista" keyed by normalized EAN with quantities and totals; saved lists as opt-in Firestore
snapshots behind a Google sign-in; copying the EAN of every item in the working list or in a
saved list, individually or all at once, one code per line; PWA install; offline boot; dark mode.

**Not built, and not to be faked:**

- **Price history and price alerts have no data.** `HistorialPrecio` and `AlmacenPrecio` are types
  only; `/historial/:ean` and `/alertas` are honest placeholders. The user confirmed
  price-watching is a real job of the product, and the repo forbids the cheap way to satisfy it —
  `sdd/02-spec.md` FR-8.4: **"nothing simulates data that does not exist."**
- No multi-store comparison, no per-unit or price-per-unit comparison, no brand filter (the source
  carries no brand field), no **catalog total** in the UI, no native app. Result counts *are*
  shown, and they are real: the search line reports how many of the matches carry a price, and the
  filter surface reports the count of the current query. What is deliberately absent is the
  catalog's total product count on the About screen (`SettingsPage.tsx:10-14`), because it changes
  with every pipeline run and `catalogo-facets.json` exposes no total to read.

**Constraints future work must not break:**

- **No fabricated data anywhere**, including failure states: FR-12.9 — "an empty view and a failed
  read are different facts"; FR-11.4 — offline "degrades honestly".
- **Static by default, with exactly one opt-in backend**: Firestore saved lists, which must
  degrade to an explanation rather than fail the app (NFR-3, amended on the record for this).
- **The main thread never holds the 20k product array**; the worker owns the catalog, and the
  index is built at build time, never in the browser.
- **EAN is the identity**; list entries are keyed by normalized EAN.
- The accessibility and tap-target rules in `docs/design-system.md` §9 are the gate for every
  change.

**Undecided — recorded, not invented:** whether **accounts** are a product requirement or an
experiment. `sdd/01-proposal.md:84` lists "no backend server, no accounts, no auth" as a non-goal,
while Google sign-in ships and saved lists require it. Asked directly, the answer was that **it is
not resolved**. Until it is, treat saved lists as a capability that exists and is gated, not as
settled product identity. Do not assume **list sharing**: it is not implemented, and it would
change the data model from owner to members.

## Brand Commitments

- **Name: Lupa**, a rebrand of "precio-scanner". The lockup is a real asset —
  `src/components/LupaLockup.tsx`, the "L" symbol plus a barcode and the LUPA wordmark — with the
  icon set in `public/` (`icon-192`, `icon-512`, `icon-maskable-512`, `favicon.ico`,
  `favicon.svg`, `apple-touch-icon.png`).
- **Voice: Argentine Spanish with voseo** — "Buscá", "Poné", "Probá", "armá" — and it says the
  true thing when something fails. The rules live in code comments and `docs/design-system.md`,
  not in a brand document.
- Confirmed with the user as **non-negotiable**: never fabricate data, and work offline after the
  first visit. The Spanish terminology and voseo were *not* marked non-negotiable; they are the
  incumbent implementation, and the repo's own design system treats that copy as settled.

## Evidence on Hand

Real, present, and not to be replaced by placeholders:

- `public/data/catalogo.json` — the real catalog (~20,331 products, 98.8% with a barcode), plus
  `catalogo-index.json` and `catalogo-facets.json` (30 categories, `priceBounds` 1 to 2,123,750).
- Real product photography by EAN from the Precios Claros CDN, with an emoji fallback.
- The brand assets above and the shipped PWA manifest.
- `sdd/` — proposal, spec, design, ledger, acceptance evidence; `sdd/04-tasks.md` is the
  authoritative ledger.

**Must never be fabricated:** multi-store prices, price-history points, real price alerts, brand
data (`marca` is always empty), testimonials, usage numbers, or a **catalog total** in the UI.
Result counts for an actual query are measured, not invented, and are shown.

## Product Principles

1. **Never present absence as data.** If a fact does not exist, say so; an empty view and a failed
   read are different things.
2. **Identify by EAN, not by name.** The code survives what the text does not.
3. **The phone in one hand decides.** Designed for a thumb mid-task in a store.
4. **Static and offline first; the network is an exception that must degrade.**
5. **Small and personal beats general.** Built for the owner and people close to them, so it stays
   simple enough to be maintained that way.

## Accessibility & Inclusion

The project's own checklist is the binding standard (`docs/design-system.md` §9, "gate for every
change"): contrast ≥ 4.5:1 for text and 3:1 for large text and icons; every icon button labelled
and at least 44×44px; visible `:focus-visible`; no information carried by color alone;
`aria-pressed` on toggles; `prefers-reduced-motion` respected. Code evidence is present across
`AppLayout`, `FilterBar`, `ProductCard` and `ScanPage`.

No external standard (no WCAG level) has been declared, and no product-specific user need has been
established — do not claim conformance to a level nobody chose.
