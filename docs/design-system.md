# Design System — precio-scanner

Source of truth for all UI decisions. Every component must consume these tokens, never
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

| Token | Purpose | Light | Dark |
| --- | --- | --- | --- |
| `surface` | Page background | `#f8fafc` (slate-50) | `#0f172a` (slate-900) |
| `surface-raised` | Cards, inputs, chips | `#ffffff` | `#1e293b` (slate-800) |
| `surface-sunken` | Selected chip (pressed category) | `#0f172a` (slate-900) | `#e2e8f0` (slate-200) |
| `border` | Card / input borders | `#e2e8f0` (slate-200) | `#334155` (slate-700) |
| `text-primary` | Product names, headings | `#0f172a` (slate-900) | `#f8fafc` (slate-50) |
| `text-secondary` | Metadata, counts | `#64748b` (slate-500) | `#94a3b8` (slate-400) |
| `text-muted` | Placeholders, hints | `#94a3b8` (slate-400) | `#64748b` (slate-500) |
| `accent` | Price emphasis, primary actions | `#15803d` (green-700) | `#4ade80` (green-400) |
| `accent-contrast` | Text/icon on accent | `#ffffff` | `#052e16` (green-950) |
| `favorite` | Favorite star (kept distinct from accent) | `#b45309` (amber-700) | `#fbbf24` (amber-400) |
| `danger` | Errors | `#dc2626` (red-600) | `#f87171` (red-400) |
| `highlight` | Fuse match `<mark>` background | `#fef08a` (yellow-200) | `#78350f` (amber-900) |

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

Scale (base 16px, line-height 1.5):

| Role | Size / weight | Usage |
| --- | --- | --- |
| `display` | 20px / 700 | App title (header) |
| `title` | 15px / 600 | Product name |
| `body` | 14px | Metadata (category, code) |
| `caption` | 12px / 500 | Counts, labels, chips |
| `price` | 18px / 700 | **Price** — always `font-variant-numeric: tabular-nums` |

**Rule:** prices render with `tabular-nums` so rows of `$ 1.290` vs `$ 12.345` don't wiggle
while scrolling. Never rigger layout shift when a price changes width.

---

## 4. Spacing & radius

4px rhythm (Tailwind default scale) → `space-y-2` (8px) between cards, `p-4` (16px) page
gutter, `gap-1.5` (6px) chip clusters.

| Token | Value |
| --- | --- |
| `radius-sm` | 6px — chips, inputs |
| `radius-md` | 8px — cards |
| `radius-full` | 999px — search input, category chips |

Elevation: flat, one subtle `shadow-sm` on cards only. No layered shadows.

---

## 5. Components & interaction

### Search input
Full width, pill (`radius-full`), `py-3` (min 44px touch target), sticky under header.
Visible `focus-visible` ring (2px, offset 2px) using `accent`. Label via `aria-label`
(`aria-label="Buscar productos"`). `type="search"`.

### Category chips
`radius-full`, 44px min height. Pressed state = `surface-sunken` background with
inverted text + `aria-pressed`. Always show focus ring.

### Sort select
Compact native `<select>` with a visible label ("Ordenar por"). Keep native control —
do not rebuild a custom dropdown.

### Product card
- `surface-raised`, `radius-md`, `shadow-sm`, `p-4`.
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

**No component library.** The repo stays plain `.jsx`/`.js` — no TS, no alias, no
`@/*` migration. shadcn was evaluated and rejected for this untyped repo: it would drag
in a `@/*` alias, `.tsx` sources coexisting with `.js`, and a shared `@theme` reset —
cost with no matching benefit for a mobile tool whose core (list/card/chips) is custom
anyway.

Shared UI is built by hand with the semantic tokens from §2, keeping identical a11y
guarantees (focus rings, ≥44px, `aria-*`). A minimal `src/components/ui/` folder can hold
`Button`, `Input`, and a bottom `Sheet` built directly. Deps stay: none beyond `lucide-react`
for icons.

New dependency: `lucide-react` (SVG icons only — no component system).

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
- Allowed: card entrance stagger (30ms), search input focus ring, press feedback.
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