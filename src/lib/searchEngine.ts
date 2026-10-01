/**
 * searchEngine — pure search/filter/sort logic, the worker's whole brain.
 *
 * Runs inside the Web Worker only (spec FR-2.2): the main thread sends a query
 * message and receives top-N results plus the total match count. Kept as a
 * dependency-free module (except Fuse) so it unit-tests in plain Node.
 */
import Fuse, { type IFuseOptions, type FuseResultMatch } from 'fuse.js'
import type { Producto, QueryParams, QueryResult } from './types'

/**
 * Fuzzy-match tunables. The only source of truth for them: `scripts/tune-threshold.ts`
 * spreads this object and overrides `threshold`, so the tuning run measures the options
 * the app actually ships instead of a copy that can silently drift (WU7.1). The chosen
 * value is recorded in `sdd/03-design.md`.
 *
 * `keys` deliberately covers `categoria` as well as `nombre`, so a category word is a
 * valid query ("bebidas"); `ignoreLocation` lets a match sit anywhere in the string,
 * which is what makes a brand word in a long name findable.
 */
export const FUSE_OPTIONS = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.35,
  ignoreLocation: true,
  // `useExtendedSearch` gives the space separator its AND meaning: `coca 2,5` becomes
  // two terms that must both match, instead of one 9-character fuzzy pattern. Measured
  // on the real 20,331-product catalog, the raw single pattern never surfaced the
  // expected product for `coca 2,5` inside the top 50 and gave 1/10 precision for
  // `zero 1,5`. It changes how a pattern is parsed, never how the index is built, so the
  // committed index in `public/data/catalogo-index.json` stays valid. User tokens are
  // neutralized by `buildQueryPattern` so input is never read as a query language.
  useExtendedSearch: true,
  keys: [
    { name: 'nombre', weight: 3 },
    { name: 'categoria', weight: 1 },
  ],
} satisfies IFuseOptions<Producto>

export const DEFAULT_LIMIT = 50

const BARCODE_MIN_DIGITS = 6

/**
 * Splits a raw query into search tokens. Whitespace separates tokens, and so do control
 * characters (U+0000-U+001F, U+007F): Fuse's extended-search parser rewrites NUL to `|`
 * internally (`parseQuery` does `.replace(/\u0000/g, '|')`), so a control character would
 * escape quoting and become an OR operator. Measured: escaped "\0" matches a product
 * containing `|` instead of the NUL it was asked for.
 */
export function tokenizeQuery(raw: string): string[] {
  return String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Wraps one user token so Fuse's extended-search parser reads it as a literal fuzzy
 * pattern instead of a query-language term. A double-quoted token always resolves to the
 * fuzzy matcher, whose pattern is the inner text handed to Bitap, i.e. literal. `|` is the
 * only operator that survives inside the quotes and is escaped with `\|`, the only escape
 * Fuse supports.
 *
 * This is not a guess. Measured without it: `!coca` returns all 20,294 products, `"a"`
 * returns 20,331, `coca|zero` returns 2,478, `=coca` returns 0. With it, 11,110 generated
 * strings (length 1..4 over `a b " \ | ! = $ ^ '`) were compared against the pre-7.7 raw
 * engine on ids AND scores to 9 decimals: zero divergences. The same comparison over the
 * metacharacter tokens of the real catalog: zero divergences.
 */
export function escapeExtendedToken(token: string): string {
  return `"${token.replace(/\|/g, '\\|')}"`
}

/**
 * Builds the Fuse pattern for a raw query: one neutralized literal term per token,
 * AND-ed by extended search's space separator. Empty query, or a query of nothing but
 * control characters, yields '' (and therefore no matches: never a browse-all).
 */
export function buildQueryPattern(raw: string): string {
  return tokenizeQuery(raw).map(escapeExtendedToken).join(' ')
}

/**
 * Merges overlapping or touching index ranges into a sorted, disjoint list. Fuse runs its
 * own `mergeIndices` inside a single match, but with multi-token queries several ranges
 * reach us already concatenated, and `src/components/HighlightedName.tsx` sorts ranges
 * without merging them: a duplicated range is emitted twice, rendering its text twice.
 * The guarantee has to live on our side.
 */
export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length <= 1) return ranges.map(([start, end]) => [start, end])
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]]
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1]
    const curr = sorted[i]
    // touching (start === last end + 1) is merged too: splitting it would render the
    // same run of characters as two adjacent pieces for no reason
    if (curr[0] <= last[1] + 1) last[1] = Math.max(last[1], curr[1])
    else merged.push([curr[0], curr[1]])
  }
  return merged
}

/** Extra-match positions attached to results when available (highlighting). */
type MatchPositions = Record<string, Array<[number, number]>>

interface Engine {
  products: Producto[]
  fuse: Fuse<Producto>
  barcodeMap: Map<string, Producto[]>
}

export type { Engine }

/**
 * Builds the engine from the loader's payload. `index` is either the wrapper
 * stored in catalogo-index.json ({ keys, fuseIndex }) or the serialized
 * Fuse.createIndex output itself (scripts/generate-index.mjs) — never
 * re-computed in the browser (Fuse.parseIndex hydrates it).
 */
export function createEngine(products: Producto[], index: unknown): Engine {
  const serialized = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (index as { fuseIndex?: unknown } | null)?.fuseIndex ?? index
  const fuse = new Fuse<Producto>(
    products,
    FUSE_OPTIONS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Fuse.parseIndex<Producto>(serialized as any),
  )
  // exact barcode lookup: EAN matching is exact by design, never fuzzy
  const barcodeMap = new Map<string, Producto[]>()
  for (const p of products) {
    if (p.barcode) {
      const hits = barcodeMap.get(p.barcode) ?? []
      hits.push(p)
      barcodeMap.set(p.barcode, hits)
    }
  }
  return { products, fuse, barcodeMap }
}

interface Filters {
  categoria?: string
  priceMin?: number | null
  priceMax?: number | null
  idSet?: Set<string> | null
}

function applyFilters(list: Producto[], { categoria, priceMin, priceMax, idSet }: Filters) {
  return list.filter((p) => {
    if (idSet && !idSet.has(p.id)) return false
    if (categoria && p.categoria !== categoria) return false
    if (priceMin != null && p.precio < priceMin) return false
    if (priceMax != null && p.precio > priceMax) return false
    return true
  })
}

function sortResults(
  list: Producto[],
  sort: QueryParams['sort'],
  scores: Map<string, number> | null,
): Producto[] {
  switch (sort) {
    case 'price-asc':
      return list.sort((a, b) => a.precio - b.precio)
    case 'price-desc':
      return list.sort((a, b) => b.precio - a.precio)
    case 'relevance':
    default:
      if (!scores) return list
      return list.sort(
        (a, b) =>
          (scores.get(a.id) ?? 1) - (scores.get(b.id) ?? 1) ||
          a.precio - b.precio,
      )
  }
}

function matchPositions(fuseMatch: { matches?: readonly FuseResultMatch[] }): MatchPositions | undefined {
  if (!Array.isArray(fuseMatch.matches)) return undefined
  const byKey: MatchPositions = {}
  for (const m of fuseMatch.matches) {
    if (m.key && Array.isArray(m.indices)) {
      byKey[m.key] = mergeRanges([...(byKey[m.key] ?? []), ...m.indices])
    }
  }
  return Object.keys(byKey).length ? byKey : undefined
}

/**
 * `ids` is the favorites mode filter: a non-empty id array restricts the match
 * set to those products (total included, so paging stays honest). Null,
 * undefined or an empty array means no filter — an empty favorites list must
 * never blank the default browse.
 */
export function runQuery(engine: Engine, params: QueryParams = {}): QueryResult {
  const {
    query = '',
    categoria = '',
    priceMin = null,
    priceMax = null,
    sort = 'relevance',
    limit = DEFAULT_LIMIT,
    offset = 0,
    ids = null,
  } = params

  const idSet: Set<string> | null =
    Array.isArray(ids) && ids.length ? new Set(ids) : null
  const filters = { categoria, priceMin, priceMax, idSet }

  const q = String(query).trim()
  const digits = q.replace(/\D/g, '')
  const isBarcodeQuery = digits.length >= BARCODE_MIN_DIGITS && !/[a-zA-Z]/.test(q)

  if (isBarcodeQuery) {
    const hits = engine.barcodeMap.get(digits)
    if (hits) {
      // exact code hit: filter+sort still apply, relevance is identity
      const filtered = applyFilters(hits, filters)
      return {
        results: sortResults(filtered, sort, null).slice(offset, offset + limit),
        total: filtered.length,
      }
    }
    // barcode-like but no exact hit: fall through to fuzzy (never invent
    // near-misses for codes) — Fuse only searches nombre/categoria, so a
    // bare EAN with no name match yields 0 without false positives
  }

  let matches: Producto[]
  let scores: Map<string, number> | null = null

  if (q) {
    // Multi-word means AND: every token becomes one neutralized literal term, joined by
    // the space separator. A query made only of control characters tokenizes to nothing
    // and must be empty, never the browse-all listing.
    const pattern = buildQueryPattern(q)
    if (pattern) {
      const fuseMatches = engine.fuse.search(pattern)
      scores = new Map(fuseMatches.map((m) => [m.item.id, m.score ?? 1]))
      matches = fuseMatches.map((m) => ({ ...m.item, _matches: matchPositions(m) }))
    } else {
      matches = []
    }
  } else {
    matches = engine.products.slice()
  }

  const filtered = applyFilters(matches, filters)
  const total = filtered.length
  const results = sortResults(filtered, sort, scores).slice(offset, offset + limit)
  return { results, total }
}