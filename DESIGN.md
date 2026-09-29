---
name: Lupa
description: A pocket aisle for one store — find a product, read its price, keep the list.
colors:
  price-green: "#15803d"
  price-ink: "#ffffff"
  aisle-light: "#f8fafc"
  shelf: "#ffffff"
  ink-slab: "#0f172a"
  shelf-edge: "#e2e8f0"
  label-ink: "#0f172a"
  label-muted: "#334155"
  label-faint: "#475569"
  star-amber: "#b45309"
  stop-red: "#dc2626"
  marker-yellow: "#fef08a"
typography:
  price-hero:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  price:
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.4
  field:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  empty-title:
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  dense-row:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
  micro:
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1
  badge:
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  3xl: "24px"
  full: "999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "24": "96px"
components:
  button-primary:
    backgroundColor: "{colors.price-green}"
    textColor: "{colors.price-ink}"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    textColor: "{colors.label-muted}"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
    padding: "0 16px"
    height: "44px"
  button-icon:
    rounded: "{rounded.full}"
    size: "44px"
  input:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.sm}"
    typography: "{typography.field}"
    padding: "0 12px"
    height: "44px"
  search-input:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.full}"
    typography: "{typography.field}"
    padding: "0 16px 0 44px"
    height: "48px"
  card-product:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.2xl}"
    padding: "12px"
  card-summary:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  card-settings:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  chip-category:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    padding: "0 16px"
    height: "44px"
  chip-category-selected:
    backgroundColor: "{colors.ink-slab}"
    textColor: "{colors.shelf}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    height: "44px"
  nav-bar:
    backgroundColor: "{colors.shelf}"
    rounded: "{rounded.3xl}"
    padding: "6px"
  nav-tab:
    textColor: "{colors.label-faint}"
    rounded: "{rounded.xl}"
    typography: "{typography.caption}"
    size: "44px"
  nav-tab-active:
    textColor: "{colors.price-green}"
  sheet:
    backgroundColor: "{colors.shelf}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  toast:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.label-ink}"
    rounded: "{rounded.md}"
  toast-action:
    textColor: "{colors.price-green}"
    rounded: "{rounded.full}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "44px"
  barcode:
    backgroundColor: "#ffffff"
    textColor: "#000000"
    padding: "12px"
---

# Design System: Lupa

## Overview

**Creative North Star: "The Pocket Aisle"**

Lupa is the aisle, carried in one hand. The interface is not a dashboard you consult and not a
catalog you browse: it is the thing you hold while standing in front of a shelf, deciding. That
scene sets every rule below — content is scanned rather than read, the column never widens past a
phone, every control is reachable by a thumb, and the loudest element on any screen is a price.

The personality is a **precision instrument that speaks plainly**: dense but legible, exact where
it counts, engineering-grade in its rhythm and its restraint, and at the same time Argentine and
close — it addresses you as *vos*, and when something fails it says so in a sentence rather than
shrugging. Those two halves are not in tension: an instrument is trustworthy because it does not
decorate, and a plainspoken tool is calm enough to say "no hay datos" instead of drawing an empty
chart.

What that produces in practice is a **flat, tonal surface system**: a quiet page, raised cards
separated by a 1px edge rather than a glow, generous rounded corners that soften a utilitarian
layout, pill-shaped chips and inputs, and one green that appears rarely and therefore reads as a
signal. Nothing is ornamental, and nothing competes with the number the user came for.

**Key Characteristics:**
- One column, 512px, at every width — phone-shaped even on a desktop browser.
- Flat by default: tone and a 1px border separate surfaces; shadow is a named hierarchy level, not
  decoration.
- Price-green is rare and therefore loud; amber is reserved for favorites so price ≠ favorite.
- Every interactive control is at least 44×44px, with a 2px accent focus ring.
- Numbers are tabular and localized `es-AR`, so a column of prices never wiggles.
- Honest states: skeleton while loading, and an explicit reason when there is no data.

## Colors

A quiet neutral page with raised white surfaces, one green that means price, one amber that means
favorite, and red/yellow held back for errors and search matches. The neutrals differ between
themes (slate-derived in light, pure neutral greys in dark); the four semantic colors keep their
identity across both.

**The normative source is the CSS custom properties in `src/index.css`** (`:root`, and the
`html[data-theme="dark"]` / `prefers-color-scheme` overrides). The frontmatter above mirrors the
light theme; the dark values are the ones the same variables take in the dark scope. Components
consume the semantic token, never a bare hex — the exceptions are listed under Do's and Don'ts.

### Primary

One accent, for prices, primary actions and the focus ring. Nothing else.

| Token | DESIGN.md name | Light | Dark |
| --- | --- | --- | --- |
| `--accent` | `price-green` | `#15803d` | `#4ade80` |
| `--accent-contrast` | `price-ink` | `#ffffff` | `#052e16` |

### Neutral

The page, the raised surfaces, the inverted surface, and the three text weights. The light theme
is slate-derived; the dark theme is a pure neutral grey family — two different families, which is
the only place the two themes do not share a hue story.

| Token | DESIGN.md name | Role | Light | Dark |
| --- | --- | --- | --- | --- |
| `--surface` | `aisle-light` | Page background | `#f8fafc` | `#171717` |
| `--surface-raised` | `shelf` | Cards, inputs, chips, sheet, nav | `#ffffff` | `#262626` |
| `--surface-sunken` | `ink-slab` | Inverted surface: selected chip, sheet backdrop | `#0f172a` | `#e5e5e5` |
| `--scrim` | — | The thing that darkens: sheet backdrop, overlays | `#0f172a` | `#0f172a` |
| `--border` | `shelf-edge` | Every card, input and divider edge | `#e2e8f0` | `#404040` |
| `--text-primary` | `label-ink` | Names, headings, prices | `#0f172a` | `#fafafa` |
| `--text-secondary` | `label-muted` | Metadata, counts, captions, section headings, nav labels | `#334155` (slate-700) | `#e5e5e5` (neutral-200) |
| `--text-muted` | `label-faint` | Placeholders, hints, inactive nav | `#475569` (slate-600) | `#a3a3a3` (neutral-400) |

### Semantic

Status colors that keep their identity in both themes.

| Token | DESIGN.md name | Role | Light | Dark |
| --- | --- | --- | --- | --- |
| `--favorite` | `star-amber` | Favorite star, warning toast text | `#b45309` | `#fbbf24` |
| `--danger` | `stop-red` | Errors, destructive affordances | `#dc2626` | `#f87171` |
| `--highlight` | `marker-yellow` | `<mark>` background for search matches | `#fef08a` | `#78350f` |

Tokens reach components through Tailwind's `@theme inline` color namespace (`bg-surface`,
`text-text-primary`, `border-border`, `bg-scrim`, …), so alpha modifiers like `bg-accent/10` stay
token-based.

Dark mode is complete and deliberate: every one of the 12 tokens is overridden, the switch is the
`data-theme` attribute on `<html>` (never a `dark:` variant — no `dark:` utility exists in the
codebase), and with no attribute the app follows `prefers-color-scheme`. The choice persists in
`localStorage` under `lupa:theme` and is applied **before first paint** by an inline script in
`index.html`, so there is no flash of the wrong theme.

### Named Rules

**The One Signal Rule.** Price-green is the only accent, and it is used for exactly three jobs:
a price, a primary action, and the focus/active state. If green appears somewhere else, one of the
two is wrong — either the element is not actually primary, or it is a price and should be
`tabular-nums` too.

**The Price ≠ Favorite Rule.** `star-amber` stays distinct from `price-green` on purpose, so the
two most important glances in the app — what it costs, and whether it is already saved — never
resolve to the same color. Never unify them.

**The Two-Theme Rule.** A new color is not finished until it has both a light and a dark value in
the same token. A single-theme color is a bug that only shows up at night in a store.

**The Legibility Floor.** All three text levels — primary, secondary and muted — clear **4.5:1**
against both `--surface` and `--surface-raised` in both themes (secondary 10.35:1 / muted 7.58:1 on
white light; 12.0:1 / 6.0:1 on the raised card dark). A placeholder may be the *faintest* color in
the palette, never an illegible one. Content a user must read (codes, price labels, section
headings, nav labels, categories) rides on `--text-secondary`, never on `--text-muted`.

## Typography

**Body Font:** the system UI stack — `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
"Helvetica Neue", Arial, sans-serif` — with `ui-monospace` (Tailwind's default `font-mono`) used
for EAN codes and barcodes only.

**Character:** no web font is downloaded, deliberately: it protects the cache-first boot promise
and removes any flash of invisible text. The scale is **hand-picked, not a ratio** — each step
exists because a specific job needed it, which is why it reads denser than a modular scale and why
several steps are arbitrary values rather than Tailwind defaults.

### Hierarchy

The list below is the whole scale, in descending order. Each entry is a **role**: a value earns
its place by having a named job, not by sitting on a ratio. Some are reused across surfaces; some
exist for a single dense surface. The prose says which is which.

- **Price hero** (700, 24px): the price on the product page. One per screen, and the largest type
  in the app.
- **Price** (700, 18px): the price on a product card and in the list, and the size shared by page
  and section headings.
- **Field** (400, 16px): text inputs and the sheet title. 16px is deliberate — anything smaller
  makes iOS zoom the page on focus.
- **Empty title** (600, 15px): the one-line heading of an empty result state ("Sin resultados").
  Single-use. It is the closest value on this scale to drift — an empty-state heading could ride
  the 18px heading step — so treat it as that surface's role and do not add a second 15px surface
  without a reason.
- **Title** (600, 14px, 1.375): product names, with `leading-snug` and up to two lines
  (`line-clamp-2`).
- **Body** (400, 14px): metadata, descriptions, button labels.
- **Dense row** (400, 13px): compact label/value rows (the About block) and the sonner toast action
  button. Reused across those two surfaces; not a licence for general body text.
- **Label** (500, 12px): counts, chips, filter labels, section headings in uppercase
  (`tracking-wide`).
- **Caption** (500, 11px): the dense-metadata step — EAN lines, "sin precio", scan results, saved-
  list captions — and the bottom-nav labels. It is reused across many dense surfaces, which is why
  the nav labels live here now instead of on the old 10px "floor".
- **Micro** (500, 10px): the EAN chip on a product card. This is the step the nav labels used to
  share; after they moved to `caption` (11px) it has exactly one remaining user. If that chip ever
  moves, the step is dead and should be deleted rather than kept as an empty rung.
- **Badge** (600, 9px): the count pill on the nav icon. Single-use, and the true floor of the
  scale.

### Named Rules

**The Tabular Price Rule.** Every price, total, count and badge renders with `tabular-nums`
(`.tnum`), so a column of `$ 1.290` and `$ 12.345` does not wiggle while scrolling and a digit
change never shifts layout. Numbers are formatted `es-AR`.

**The No Fourth Size Rule.** Reach for one of the roles above before inventing a value. A single-use
role (9px, 10px, 15px) is not a licence for a new size per screen; a reused role (11px, 13px) is
not a general-purpose body step either.

## Layout

A single 512px column (`max-w-lg`), centered, at every viewport width. **No responsive prefix
exists anywhere in the codebase** — no `sm:`, `md:`, `lg:` — and that is intentional: on a wide
screen the content stays phone-shaped rather than growing a second column. Desktop is not a
target; a laptop is the rare case.

- **Page gutter:** `px-4` (16px). **Container:** `mx-auto w-full max-w-lg px-4`.
- **Rhythm:** Tailwind's 4px base. `space-y-2` (8px) between cards, `p-4` (16px) card padding,
  `gap-1.5` (6px) inside chip clusters, `gap-3`/`gap-4` for tile rows.
- **Vertical budget:** the layout outlet reserves `pb-24` (96px) for the fixed bottom nav. The
  product page reserves the same for its add-to-list dock.
- **Device chrome:** `min-h-dvh` rather than `100vh`, `env(safe-area-inset-*)` on the nav, the scan
  top bar, the scan dock and the toasts (`.safe-top` / `.safe-bottom` utilities exist for this),
  and a viewport meta that never disables zoom.
- **Fixed furniture:** bottom nav (z-30), scan dock (z-20), sheet (z-50). The search header on the
  results page is `sticky top-0` with `bg-surface/95 backdrop-blur`.
- **No horizontal scroll, ever.** Long names truncate or clamp; they never push the column wider.

## Elevation & Depth

The system is **flat-toned with a named shadow hierarchy**. Depth is primarily carried by **tone**:
the page is `aisle-light`, a card is `shelf` (or the inverse), and a 1px `shelf-edge` border draws
the boundary. Shadows are not decoration and not a substitute for that edge — each one is a
**named level that means a specific kind of separation**, which is the rule this system follows.

### Shadow Vocabulary

| Level | Value (Tailwind default) | Meaning |
| --- | --- | --- |
| Rest | none | Everything on the plane: page content, sections, dividers. Separated by tone + 1px edge. |
| Card | `shadow-sm` — `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` | A card that is one step above the page: skeleton rows, product cards, the active segment of a control. |
| Floating | `shadow-lg` — `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | Furniture that floats over content and is always present: the bottom nav pill, the sheet panel, the add-to-list dock. |
| Floating, raised | `shadow-xl` — `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)` | Contextual cards that appear over the live camera feed, where the contrast against video needs the strongest separation. |
| Accent tile | `shadow-md` — `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | The single scan tile in the nav: the one deliberately raised affordance in the chrome. |

There is one non-token shadow, and it is a mechanism rather than elevation:
`shadow-[0_0_0_9999px_rgba(2,6,23,0.6)]` on the scan window, used as a spread-out mask to darken
everything outside the cutout. Do not reach for it as a shadow.

### Named Rules

**The Named Level Rule.** A shadow must correspond to one of the levels above, chosen for what the
element *is*. Adding a shadow to a resting surface, or inventing a value between two levels, ends
the hierarchy's meaning.

**The Tone First Rule.** Before adding a shadow to separate two surfaces, use tone and the 1px
`shelf-edge` border. The edge is the default separator; a shadow is reserved for elements that
float above the plane.

## Shapes

Rounded and soft, on a flat plane: pills for anything you tap that holds a value (chips, inputs,
badges, icon buttons), and corners that grow with the size of the surface — 12px for a small card
or segment, 16px for a card, 24px for the bottom nav pill. The sheet rises with only its top
corners rounded. Borders are **1px** everywhere, with two deliberate exceptions: the scan
viewfinder brackets (4px, described in Components) and the empty state's dashed edge.

The scale is Tailwind's, with two project overrides that matter:

| Step | Value | Used for |
| --- | --- | --- |
| `rounded-sm` | **6px** (overridden from Tailwind's 4px) | Buttons, inputs, selects, skeleton bars, search highlights |
| `rounded-md` | **8px** (overridden from Tailwind's 6px) | Sheet radius token, skeleton rows, error/empty boxes |
| `rounded-lg` | 8px (Tailwind default) | Theme radiogroup, list view selector, the scan brackets |
| `rounded-xl` | 12px | Nav tabs, quick-entry tiles, the segmented selectors, settings cards |
| `rounded-2xl` | 16px | Product card, sheet panel (top corners only), list items, hero cards |
| `rounded-3xl` | 24px | The bottom nav pill |
| `rounded-full` | 999px | Chips, search input, icon buttons, count badges, avatars |

**Known collision: `rounded-md` and `rounded-lg` both resolve to 8px**, because the project's
override of `md` lands on Tailwind's default `lg`. They are interchangeable today; pick one
deliberately rather than assuming a step exists between them, and do not "fix" it by shrinking `md`
without checking every card that relies on it.

## Components

### Buttons

- **Shape:** `rounded-sm` (6px), minimum height 44px, `font-medium`, `transition`.
- **Primary:** `price-green` background with `price-ink` text, `hover:opacity-90`,
  `active:opacity-95`. Opacity rather than a second green keeps one accent token.
- **Secondary:** `shelf` background, 1px `shelf-edge` border, `label-ink` text; hover and active
  recede the background to `aisle-light`.
- **Ghost:** `label-muted` text, no border; hover and active recede to `aisle-light`.
- **Icon:** `44×44px`, `rounded-full` (or `rounded-xl` in the nav), `aria-label` mandatory.
- **Disabled:** `opacity-50` plus `pointer-events-none`. Never a different size or color.

### Chips

- **Style:** `rounded-full`, `min-h-11` (44px), 1px `shelf-edge` border, `shelf` background,
  `label-ink` text at 12px.
- **Selected:** inverts to `ink-slab` background with `shelf` text, plus `aria-pressed`. Color is
  never the only signal.
- **Active filter:** `price-green` text on a 10% `price-green` fill with a 40% edge — the same
  accent-chip idiom the toast action uses.

### Cards / Containers

- **Corner:** `rounded-2xl` (16px) for content cards, `rounded-xl` (12px) for settings cards.
- **Background:** `shelf` on `aisle-light`; a 1px `shelf-edge` border always draws the boundary.
- **Shadow:** the Card level, or none — see Elevation.
- **Padding:** 12px for a dense product row, 16px for a summary or settings card.
- **Press feedback:** the background darkens (`active:bg-surface`); nothing moves and nothing
  resizes.

### Inputs / Fields

- **Style:** `shelf` background, 1px `shelf-edge` border, `rounded-sm` (6px), 16px text, min 44px
  tall. The search field is the exception: `rounded-full`, 48px tall, with the icon inset at 44px
  of left padding.
- **Focus:** the global 2px `price-green` outline at 2px offset, plus a `price-green` border shift
  on the inputs that opt into it. Never a glow, never a shadow.
- **Error:** `stop-red` text with the message naming the cause; the field itself is not recolored
  red on its own.

### Navigation

A fixed, floating pill: `shelf` background, `rounded-3xl`, 1px edge, Floating shadow, five slots
— Inicio · Alertas · [Escanear] · Lista · Perfil. Each tab is pinned to a **44×44px** minimum with
an 11px label (`caption`); inactive tabs are `label-muted` (--text-secondary), the active tab is `price-green`. The centre scan
slot is the one accent-filled, `shadow-md` tile in the chrome, and it is the only raised
affordance there. The list count badge is an accent pill, `aria-hidden`, paired with an `sr-only`
sentence — the number is never announced twice.

**Entry points are limited on purpose.** A sixth slot is not available: five 44px targets is what
fits. New destinations are reached from a page, not from the nav.

### Sheet

The bottom sheet owns the filter surface and any secondary flow: full-width, `max-w-lg`,
`rounded-t-2xl`, 1px top border, `shelf` background, Floating shadow, `safe-bottom` padding.
It animates in (fade 200ms + rise 240ms, `ease-out`) and is a real dialog: `role="dialog"`,
`aria-modal`, `aria-labelledby`/`aria-describedby`, focus moved into the panel and trapped there
while it is open (Tab cycles the panel's controls; the rest of the page is inert), focus returned
to the control that opened it on close, Escape and backdrop close, body scroll locked. The backdrop
uses the `--scrim` token (`bg-scrim/40`) — a scrim darkens, in both themes. Maximum height `70dvh`
with an internal scroll.

### Toasts

One `<Toaster />` in `src/main.tsx`, bottom-centre, offset **`calc(6.5rem + env(safe-area-inset-bottom, 0px))`** — measured against the ~87px nav, leaving ~21px of gap; re-measure if the nav
changes. Themed entirely through the token block in `src/index.css` (never sonner's palette): flat
on `shelf`, 1px edge, `rounded-md`, only the *text* changes per status (`price-green` success,
`star-amber` warning, `stop-red` error). The action button is the accent chip at 44px minimum.
Copy: a short title, the product name in `description`, and `Deshacer` instead of a blocking
dialog — destructive actions are reversible, not prevented.

### Product card (signature component)

The densest and most repeated surface in the app: `rounded-2xl`, `shelf`, 1px edge, 12px padding,
`flex gap-3`. A 56px image tile (`rounded-xl`, decorative: `alt=""`, the name is adjacent text) on
the left; then the name (Title, `leading-snug`, two lines max — it is the card's stretched
activation control: a real `<button>` whose pseudo-element covers the whole card, so the card is
one tap target and keyboard-activatable without nesting interactive content), the category in 11px
`label-muted`, and an EAN chip in `font-mono` 10px on a 10% `price-green` fill with a 40% edge; the
price sits right in Price type with `tabular-nums`; the add button is a 44px `rounded-xl` control
that fills with `price-green` once the item is in the list, carrying `aria-pressed` and a label.

Every interactive control in the card is at least 44×44px; the add button was the last
interactive control in the system under 44px until the same pass raised the `/guardadas` per-list
delete button from 36px, so the product-card exception is retired. Keeping it honest: the
harness's `TOUCH-*` acceptance rows gate this rule on the routes it can render — `/lista`,
`/producto`, `/buscar` (plus chips), `/perfil` (theme, chips) and `/guardadas` **in its
signed-out contract** (the page the unauthenticated browser actually sees). The signed-in
delete button's 44px size is enforced by the same `h-11 w-11` class used everywhere else,
but no `TOUCH-*` row exercises it: signing in is not something an automated browser run can
assert. The gate is on measured rendered controls; the class is on the rest.

### Camera & scan shell (deliberate exceptions)

The immersive scanner is one coherent exception to the token world, not a place where tokens
forgot to land: what sits ON the camera feed is not part of the palette system, because the
video it overlays is itself an unthemeable raw image. There the code deliberately uses raw
values so the overlay tracks the feed, not the theme:

- the scan shell behind the feed (`bg-slate-950`) and the cutout mask around the scan window
  (`rgba(2,6,23,0.6)` shadow);
- the translucent pills and buttons on the feed (`bg-black/40`, `bg-black/50`, `bg-black/60`)
  with `text-white`;
- the scan window and corner brackets (`border-white/40`, `border-white`);
- the scanner's loading state (`ScanLoading`: `bg-slate-900`, `text-white/70`), which matches
  the dark shell so a slow scan-chunk fetch never flashes the page white before the camera
  view appears.

Everything ELSE on the scan page — the no-camera compact layout, the detection card, the dock
— is ordinary UI on ordinary surfaces and uses tokens like everywhere else. A raw value outside
the barcode and the camera surface listed above is a defect, not a choice.

### Barcode (deliberate exception)

The rendered barcode is always **pure black on pure white** (`#000000` / `#ffffff`), regardless of
theme, because a scanner needs that contrast and the token palette would break it. Together with
the camera surface above, these are the deliberate raw values in the app — and the barcode's
white box is required by the hardware, while the camera values are required by the feed; neither
is an invitation to use raw values anywhere else.

## Do's and Don'ts

Carried from the system's own contract (mobile-first, price-first, honest states) and from what the
implementation already does. Each one is grounded in this file or in the code, not in taste.

### Do:

- **Do** design at 512px and below, and let it center on anything wider. A layout that needs a
  second column is out of scope.
- **Do** give every price, total, count and badge `tabular-nums`, and format numbers `es-AR`.
- **Do** keep every tap target at 44×44px or larger, and give every icon-only control an
  `aria-label`.
- **Do** pair color with a second signal for any state — `aria-pressed`, an icon, or a label.
- **Do** use the 2px `price-green` focus ring at 2px offset on every interactive element.
- **Do** separate surfaces with tone and the 1px `shelf-edge` border first, and add a shadow only
  at one of the named levels.
- **Do** show a skeleton that matches the real card geometry while loading, and an explicit reason
  plus one recovery action when there is no data.
- **Do** respect `prefers-reduced-motion` (a global block already collapses animation and
  transition durations to `0.01ms`).
- **Do** use SVG icons from lucide-react, sized 13–22px, inheriting `currentColor`.

### Don't:

- **Don't** add a `dark:` variant or a second theme mechanism. Theme lives in the `data-theme`
  attribute and the token scope, and nothing else.
- **Don't** introduce a second accent color, or use `star-amber` for anything but favorites and
  warnings.
- **Don't** convey information by color alone.
- **Don't** use emojis as structural icons, or as an empty-state illustration — the one emoji in
  the codebase is a fallback inside a product image, not chrome.
- **Don't** animate width, height or layout; motion is transform and opacity only, 150–300ms,
  `ease-out` entering.
- **Don't** add layered or decorative shadows, glows, or gradient surfaces — the gradients that
  exist are the nav's fade-to-transparent ground, not decoration.
- **Don't** build hover-reveal controls or hover-only affordances; there is no hover on a phone.
- **Don't** rebuild a native control (the sort `<select>` stays native) and don't add a component
  library.
- **Don't** widen the column, add a desktop grid, or introduce a responsive breakpoint.
- **Don't** use a blocking `window.confirm` for a destructive action; make it reversible with
  `Deshacer`.
