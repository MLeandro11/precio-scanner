/**
 * searchEngine — pure search/filter/sort logic, the worker's whole brain.
 *
 * Runs inside the Web Worker only (spec FR-2.2): the main thread sends a query
 * message and receives top-N results plus the total match count. Kept as a
 * dependency-free module (except Fuse) so it unit-tests in plain Node.
 */
import Fuse from 'fuse.js'

const FUSE_OPTIONS = {
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

/**
 * Builds the engine from the loader's payload. `index` is either the wrapper
 * stored in catalogo-index.json ({ keys, fuseIndex }) or the serialized
 * Fuse.createIndex output itself (scripts/generate-index.mjs) — never
 * re-computed in the browser (Fuse.parseIndex hydrates it).
 */
export function createEngine(products, index /* , facets */) {
  const serialized = index?.fuseIndex ?? index
  const fuse = new Fuse(products, FUSE_OPTIONS, Fuse.parseIndex(serialized))
  // exact barcode lookup: EAN matching is exact by design, never fuzzy
  const barcodeMap = new Map()
  for (const p of products) {
    if (p.barcode) {
      const hits = barcodeMap.get(p.barcode) ?? []
      hits.push(p)
      barcodeMap.set(p.barcode, hits)
    }
  }
  return { products, fuse, barcodeMap }
}

function applyFilters(list, { categoria, priceMin, priceMax }) {
  return list.filter((p) => {
    if (categoria && p.categoria !== categoria) return false
    if (priceMin != null && p.precio < priceMin) return false
    if (priceMax != null && p.precio > priceMax) return false
    return true
  })
}

function sortResults(list, sort, scores) {
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

function matchPositions(fuseMatch) {
  if (!Array.isArray(fuseMatch.matches)) return undefined
  const byKey = {}
  for (const m of fuseMatch.matches) {
    if (m.key && Array.isArray(m.indices)) {
      ;(byKey[m.key] ??= []).push(...m.indices)
    }
  }
  return Object.keys(byKey).length ? byKey : undefined
}

/**
 * @param {object} params { query, categoria, priceMin, priceMax, sort, limit, offset }
 * @returns {{ results: Product[], total: number }}
 */
export function runQuery(engine, params = {}) {
  const {
    query = '',
    categoria = '',
    priceMin = null,
    priceMax = null,
    sort = 'relevance',
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = params

  const q = String(query).trim()
  const digits = q.replace(/\D/g, '')
  const isBarcodeQuery = digits.length >= BARCODE_MIN_DIGITS && !/[a-zA-Z]/.test(q)

  if (isBarcodeQuery) {
    const hits = engine.barcodeMap.get(digits)
    if (hits) {
      // exact code hit: filter+sort still apply, relevance is identity
      const filtered = applyFilters(hits, { categoria, priceMin, priceMax })
      return {
        results: sortResults(filtered, sort, null).slice(offset, offset + limit),
        total: filtered.length,
      }
    }
    // barcode-like but no exact hit: fall through to fuzzy (never invent
    // near-misses for codes) — Fuse only searches nombre/categoria, so a
    // bare EAN with no name match yields 0 without false positives
  }

  let matches
  let scores = null

  if (q) {
    const fuseMatches = engine.fuse.search(q)
    scores = new Map(fuseMatches.map((m) => [m.item.id, m.score ?? 1]))
    matches = fuseMatches.map((m) => ({ ...m.item, _matches: matchPositions(m) }))
  } else {
    matches = engine.products.slice()
  }

  const filtered = applyFilters(matches, { categoria, priceMin, priceMax })
  const total = filtered.length
  const results = sortResults(filtered, sort, scores).slice(offset, offset + limit)
  return { results, total }
}
