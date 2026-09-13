/**
 * searchEngine — pure search/filter/sort logic, the worker's whole brain.
 *
 * Runs inside the Web Worker only (spec FR-2.2): the main thread sends a query
 * message and receives top-N results plus the total match count. Kept as a
 * dependency-free module (except Fuse) so it unit-tests in plain Node.
 */
import Fuse, { type IFuseOptions, type FuseResultMatch } from 'fuse.js'
import type { Producto, QueryParams, QueryResult } from './types'

const FUSE_OPTIONS: IFuseOptions<Producto> = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.35,
  ignoreLocation: true,
  keys: [
    { name: 'nombre', weight: 3 },
    { name: 'categoria', weight: 1 },
  ],
}

export const DEFAULT_LIMIT = 50

const BARCODE_MIN_DIGITS = 6

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
      ;(byKey[m.key] ??= []).push(...m.indices)
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
    const fuseMatches = engine.fuse.search(q)
    scores = new Map(fuseMatches.map((m) => [m.item.id, m.score ?? 1]))
    matches = fuseMatches.map((m) => ({ ...m.item, _matches: matchPositions(m) }))
  } else {
    matches = engine.products.slice()
  }

  const filtered = applyFilters(matches, filters)
  const total = filtered.length
  const results = sortResults(filtered, sort, scores).slice(offset, offset + limit)
  return { results, total }
}