# Design System — Lupa

> **The token authority is [`DESIGN.md`](../DESIGN.md)** at the repository root, mirrored from the
> CSS custom properties in `src/index.css`, which stay the normative source of the values. This
> file is the human-readable companion: it explains intent, rationale and anti-patterns. If a
> value here disagrees with the code, the code wins — and correcting it here is a doc fix, not a
> design change.

The visual rules for all UI decisions. Every component must consume these tokens, never
raw ad-hoc values. Derived from UI/UX best practices (accessibility, touch, layout,
typography) and tuned for this product's job: **find a product and read its price fast**.

Product type: **mobile-web app** (React + Vite, served from GH Pages). It is a phone-first
catalog lookup over ~20k retail products. **Primary target: mobile browser.** Desktop is a
laptop/tablet rarely; it is NOT optimized for wide desktop layouts.

---

## 0. Mobile-first (the design contract)

The app is a mobile web app. Everything below assumes a phone in one hand, often mid-task
(in a store, comparing prices), thumb-reach zone, one-price-read target.

- **Single column layout at all widths.** No desktop multi-column grids to chase. On wide
  screens content just centers within `max-w-lg` and stays phone-shaped.
- **Thumb-zone friendliness.** Primary action (search) top; filters reachable without
  re-scrolling; the bottom edge holds "load more".
- **Respect device chrome.** Safe-area insets (`env(safe-area-inset-*)`) for the notch and
  the home-indicator bar; `min-h-dvh` (not `100vh`); no horizontal scroll; viewport meta
  already correct (`width=device-width, initial-scale=1`, never disable zoom).
- **Feels native.** Instant boot from cache, touch feedback <100ms, no hover-only
  interactions, tapping not clicking.
- **Filters as a bottom sheet** (Drawer/Sheet), not an inline bar that pushes the list.
  Search bar stays sticky on top; the list fills from under it to the bottom CTA.
- **Read price in one glance.** `tabular-nums`, accent on the price, name second.

Anti-patterns: desktop-first layouts, hover-reveal controls, wide data grids, density
that assumes a mouse, anything that needs a cursor.

## 1. Design principles

1. **Price first.** The price and the product name are the only elements that get visual
   weight. Everything else is quiet.
2. **Scan, don't read.** Users are skimming a long list. High density, strong scannable
   rhythm, minimal decoration.
3. **One thread.** Search → filter → read price. No onboarding, no marketing, no fluff.
4. **Works from cache.** Boot feels instant on repeat visits; nothing should imply a
   "server round trip".

Anti-patterns to avoid: heavy gradients, decorative animation, playful/rounded-everything
e-commerce sugar, icon-only controls without labels, emojis as structural icons (use SVG).

---

## 2. Color tokens

Semantic tokens map to concrete values in one place. Components reference the semantic
name, never a bare hex.

Light is the default theme. Dark mode is ACTIVE: the app follows the device
`prefers-color-scheme` by default, and a manual override (Sistema / Claro / Oscuro) lives
on the Perfil page, persisted in `lupa:theme`. The override sets `data-theme` on `<html>`, a
mapping change — not a component refactor.

| Token | DESIGN.md | Purpose | Light | Dark |
| --- | --- | --- | --- | --- |
| `surface` | `aisle-light` | Page background | `#f8fafc` (slate-50) | `#171717` (neutral-900) |
| `surface-raised` | `shelf` | Cards, inputs, chips | `#ffffff` | `#262626` (neutral-800) |
| `surface-sunken` | `ink-slab` | Selected chip (pressed category) | `#0f172a` (slate-900) | `#e5e5e5` (neutral-200) |
| `border` | `shelf-edge` | Card / input borders | `#e2e8f0` (slate-200) | `#404040` (neutral-700) |
| `text-primary` | `label-ink` | Product names, headings | `#0f172a` (slate-900) | `#fafafa` (neutral-50) |
| `text-secondary` | `label-muted` | Metadata, counts | `#64748b` (slate-500) | `#a3a3a3` (neutral-400) |
| `text-muted` | `label-faint` | Placeholders, hints | `#94a3b8` (slate-400) | `#737373` (neutral-500) |
| `accent` | `price-green` | Price emphasis, primary actions | `#15803d` (green-700) | `#4ade80` (green-400) |
| `accent-contrast` | `price-ink` | Text/icon on accent | `#ffffff` | `#052e16` (green-950) |
| `favorite` | `star-amber` | Favorite star (kept distinct from accent) | `#b45309` (amber-700) | `#fbbf24` (amber-400) |
| `danger` | `stop-red` | Errors | `#dc2626` (red-600) | `#f87171` (red-400) |
| `highlight` | `marker-yellow` | Fuse match `<mark>` background | `#fef08a` (yellow-200) | `#78350f` (amber-900) |

The light neutrals are **slate**-derived and the dark ones are **neutral**-derived — two different
families. An earlier version of this table listed the dark column in slate values (`#0f172a`,
`#1e293b`, `#334155`, `#f8fafc`, `#94a3b8`, `#64748b`) that the code never used; corrected against
`src/index.css`. The four semantic colors are identical in both themes.

**Rules:**
- Body text on surface must be ≥ **4.5:1**; secondary ≥ **3:1**.
- Do not convey state with color alone — always pair with icon/text (e.g. `aria-pressed`, label).
- The `favorite` amber stays separate from `accent` green so price ≠ favorite at a glance.

---

## 3. Typography

System font stack (no web font download — keeps the cache-first promise and avoids FOIT).

```css
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
```

Scale (base 16px, line-height 1.5). The steps are **hand-picked, not a ratio** — each one exists
because a surface needed it:

| Role | Size / weight | Usage |
| --- | --- | --- |
| `price-hero` | 24px / 700 | Price on the product page |
| `price` | 18px / 700 | **Price** in cards and lists — always `tabular-nums`; the size is shared by page and section headings |
| `field` | 16px / 400 | Inputs and the sheet title (smaller makes iOS zoom the page on focus) |
| `title` | 14px / 600 | Product name (`leading-snug`, two lines max) |
| `body` | 14px | Metadata (category, code), button labels |
| `label` | 12px / 500 | Counts, labels, chips, uppercase section headings |
| `micro` | 10px / 500 | Bottom-nav labels, EAN chip. 11px and 9px are the floor, for dense list metadata and the nav badge |

An earlier version of this table listed `display 20px/700` and `title 15px/600`, neither of which
exists in the code; corrected against the utilities actually used in `src/`.

**Rule:** prices render with `tabular-nums` so rows of `$ 1.290` vs `$ 12.345` don't wiggle
while scrolling. Never rigger layout shift when a price changes width.

---

## 4. Spacing & radius

4px rhythm (Tailwind default scale) → `space-y-2` (8px) between cards, `px-4` (16px) page
gutter and `p-4` (16px) card padding, `gap-1.5` (6px) chip clusters.

| Token | Value |
| --- | --- |
| `radius-sm` | 6px — chips, inputs |
| `radius-md` | 8px — cards |
| `radius-full` | 999px — search input, category chips |

Elevation: flat by default, with a **named shadow hierarchy** — rest (none), card (`shadow-sm`),
accent tile (`shadow-md`), floating (`shadow-lg`), floating-raised (`shadow-xl`). Tone and the 1px
border separate surfaces first; a shadow is reserved for what floats above the plane. The levels
and what each one means live in `DESIGN.md` → Elevation & Depth.

*(This line previously read "flat, one subtle `shadow-sm` on cards only. No layered shadows."
which did not match the code: `shadow-md`, `shadow-lg` and `shadow-xl` are all in use, each for a
different kind of floating surface.)*

---

## 5. Components & interaction

### Search input
Full width, pill (`radius-full`), `min-h-11` (44px) with 16px text so iOS never zooms the page,
sticky under header.
Visible `focus-visible` ring (2px, offset 2px) using `accent`. Label via `aria-label`
(`aria-label="Buscar productos"`). `type="search"`.

### Category chips
`radius-full`, 44px min height. Pressed state = `surface-sunken` background with
inverted text + `aria-pressed`. Always show focus ring.

### Sort select
Compact native `<select>` with a visible label ("Ordenar por"). Keep native control —
do not rebuild a custom dropdown.

### Product card
- `surface-raised`, `rounded-2xl` (16px), 1px `shelf-edge` border, `p-3` (12px). **No shadow** —
  the card is separated by tone and its edge, per the Tone First rule.
- **Name** (title) top-left; **favorite** star (SVG) top-right, min 44×44 hit area.
- Bottom row: category + barcode (caption, secondary) left; **price** (price role, accent
  color) right, `tabular-nums`.
- Press feedback: background darkens on `:active`; no layout shift.

### Favorite star
SVG icon (lucide `Star` / `StarFill`), not the `★` glyph. Min hit area 44×44 even if the
glyph is smaller. `aria-pressed` + `aria-label` ("Agregar a favoritos" / "Quitar de
favoritos"). Amber when active.

### Empty / loading states
- **Loading results:** skeleton rows (shimmer) matching card geometry, not a text spinner.
- **Empty state:** SVG icon + title + reason + one recovery action. No emoji.

---

## 6. Icons

Use **lucide-react** (consistent 24px grid, 2px stroke, SVG, themable). All icons become
semantic tokens via `currentColor`.

Required set (initial):
`Search`, `Star` (outline) / `StarFill` (filled, favorite), `PackageSearch` or
`SearchX` (empty state), `ArrowUp`/`ArrowDown` (sort indicators if added).

---

## 7. Layout & responsive (mobile-first)

- **Single column always.** `max-w-lg` (512px) centered. Even on a desktop browser the
  app stays phone-shaped — do not chase desktop multi-column layouts.
- Page gutter `px-4`; full-width sticky header (identity + search).
- Filters live in a **bottom sheet** (in-house, JS), opened from a toolbar row; the
  category chips and the price range sit inside it. The list is the star.
- Touch targets **≥44×44px** everywhere (enforce via padding, not glyph shrink).
- `min-h-dvh` on the page shell; `env(safe-area-inset-bottom)` padding above the home
  indicator and before "load more".

## 7b. Implementation route: in-house JS (decided)

**No component library.** shadcn was evaluated and rejected: it would drag in a `@/*` alias (which
the repo still does not have), `.tsx` sources coexisting with `.js`, and a shared `@theme` reset —
cost with no matching benefit for a mobile tool whose core (list/card/chips) is custom anyway.

Shared UI is built by hand with the semantic tokens from §2, keeping identical a11y
guarantees (focus rings, ≥44px, `aria-*`). `src/components/ui/` now holds `Button`, `Input`,
`Skeleton` and the bottom `Sheet`, built directly.

Runtime dependencies today: `lucide-react` (icons), `react-router-dom` (routing), `sonner`
(toasts, §7c), `@zxing/browser` (camera scanning), `fuse.js` (search), `jsbarcode` (list barcode
view), `firebase` (auth and saved lists, lazily loaded) and `vite-plugin-pwa`. None of them is a
component library, so the decision this section records still holds.

*(Correction: this section used to say the repo "stays plain `.jsx`/`.js` — no TS" and that deps
stayed "none beyond `lucide-react`". Both stopped being true when the codebase migrated to strict
TypeScript and grew its other runtime dependencies.)*

---

## 7c. Transient feedback: toasts (sonner)

Silent actions — remove, undo, "added to my list", favourite — confirm themselves with a
**toast**. The app uses **sonner** for that (the one UI dependency beyond `lucide-react`;
it is a toast primitive, not a component library, so §7b still holds).

One `<Toaster />` lives in `src/main.tsx` as a sibling of `<App />`, never inside a page and
never inside `App` itself: `App` returns early for the boot and error screens, so a Toaster
in its final return would be missing exactly when feedback matters.

**The toaster is themed only through the token mapping block in `src/index.css` (§2 tokens,
no bare hex).** sonner's own stylesheet is completely unlayered and declares its palette on
`[data-sonner-toaster][data-sonner-theme=…]` (specificity 0,2,0), so:

- The overrides stay **unlayered**. Moved into `@layer base`, `@layer components` or
  `@layer utilities`, they would silently lose to sonner regardless of specificity.
- The **composite selector is load-bearing**: `html [data-sonner-toaster][data-sonner-theme]`
  reaches specificity 0,2,1 and beats sonner's `[data-sonner-toaster][data-sonner-theme=…]`
  palette at 0,2,0. That is specificity, not source order, which is why it wins regardless of
  where the two bundles land. Do not "tidy" it into a plain `[data-sonner-toaster]` rule.
- The two dark re-declarations (`html[data-theme="dark"] …` and the
  `@media (prefers-color-scheme: dark)` block scoped to `html:not([data-theme="light"])`) are
  a **cascade anchor kept deliberately but currently redundant**. The toaster is mounted
  without a `theme` prop, so sonner always renders `data-sonner-theme="light"` (its default)
  and its own dark palette never matches; the base block's `var()` references already flip
  with `html[data-theme]`, so both dark blocks restate the same values and change no computed
  result. They are kept to document the dark palette, not because they win anything.
- `font-family: var(--font-sans)`, `--border-radius: var(--radius-md)`, and the description
  colour (sonner hard-codes it) belong to the same block: sonner's defaults are a foreign
  font stack and a grey that fails contrast on the dark surface.
- The **action button** (`Deshacer`) is styled as the accent chip — the same idiom §7b's
  `ProductCard` and `ProductPage` use for an accented affordance: `--accent` text on a 10%
  accent fill with a 40% accent edge, `--radius-full`, and `min-height: 44px` (§9). sonner's
  default inverts the toast palette instead (`background: var(--normal-text)`, `color:
  var(--normal-bg)`), which paints a near-black slab inside a light toast. Raw CSS has no
  `/10` alpha modifier, so the block uses `color-mix(in oklab, var(--accent) 10%,
  transparent)` — the same function Tailwind emits for `bg-accent/10`, so it is still a
  token, not a hex. sonner's hard-coded `rgba(0, 0, 0, .4)` focus ring is dropped so only
  the §5 accent outline shows; that override needs the `[data-action]:focus-visible`
  compound to out-specify sonner's own button ring.
- The theme comes from the `html[data-theme]` attribute (§2), **not** from sonner's `theme`
  prop: `useTheme` has no cross-instance sync, so a second instance in `main.tsx` would go
  stale when the user switches theme on the Perfil page.

**Placement.** `position="bottom-center"`, with `offset` and `mobileOffset` bottom set to
`calc(6.5rem + env(safe-area-inset-bottom, 0px))`. The bottom nav (§7) is ~87px tall at a
390px viewport, and its padding carries the same `env(safe-area-inset-bottom)`, so the gap
between the two stays constant on notched devices. The value is **measured, not guessed**:
the nav pill's top edge sits 83px above the viewport bottom, and an earlier 5.5rem left the
toast touching the nav at ~5px, so 6.5rem holds ~21px. sonner's default `bottom-0` would hide
every toast behind the nav. If the nav's height changes, re-measure rather than re-estimate.
If the nav's height changes, revisit that value.

**Copy.** Phone UI: short title, long product name in `description`
(`toast('Quitado de la lista', { description: nombre })`). Prefer plain `toast` over
`toast.success`/`toast.error` unless the type adds meaning. Destructive actions are
reversible (a `Deshacer` action), not prevented by a blocking `window.confirm`.

**Motion.** sonner already ships its own `prefers-reduced-motion` block — do not add a
second one (§8).

---

## 8. Motion

Sober, purposeful.
- Durations **150–300ms**, `ease-out` entering, `ease-in` exiting.
- Allowed: search input focus ring, press feedback, sheet entrance, skeleton shimmer.
  *(The "card entrance stagger (30ms)" formerly listed here was never implemented; removed rather
  than left as a rule nobody follows.)*
- **Honor `prefers-reduced-motion`** — disable decorative motion.
- No width/height animation (transform/opacity only), no layout reflow.

---

## 9. Accessibility checklist (gate for every change)

- [ ] Body/secondary contrast ≥ 4.5:1 / 3:1.
- [ ] Every icon button has `aria-label` and a ≥44px hit target.
- [ ] Visible `:focus-visible` ring on all interactive elements.
- [ ] No information conveyed by color alone.
- [ ] `aria-pressed` on toggles (favorite, category), `aria-live="polite"` on counts.
- [ ] `prefers-reduced-motion` respected.
- [ ] Prices use `tabular-nums`; numbers localized `es-AR`.

---

## 10. Migration plan (component → token)

*Historical: this was the plan for the token migration, which landed. The implementation is strict
TypeScript, so the `.jsx` filenames below are the plan's version names, not the current paths.*

| Component | Changes |
| --- | --- |
| `src/index.css` | Define semantic tokens (custom props for each token in §2); set font stack + `tabular-nums`; `@theme` (Tailwind v4) mapping. |
| `App.jsx` | Header w/ identity + title; `max-w-lg` shell; `min-h-dvh` + safe areas; loading skeleton; filter toolbar opening the bottom Sheet. |
| `src/components/ui/` | New — in-house `Button`, `Input`, bottom `Sheet` using tokens. |
| `SearchBar.jsx` | Use in-house `Input`, tokens, min-height 44px, `Search` icon (lucide). |
| `FilterBar.jsx` | Content moves into the bottom `Sheet`; custom chips w/ tokens + focus rings. |
| `SortSelect.jsx` | Native select w/ tokens, or compact in-house dropdown. |
| `ProductCard.jsx` | Token card, `tabular-nums` price in `accent`, lucide star. |
| `ProductList.jsx` | Skeleton rows, in-house `Empty` state, "load more" respecting safe-area inset. |

New dependency: `lucide-react` (icons only). No TS, no alias, no component library.