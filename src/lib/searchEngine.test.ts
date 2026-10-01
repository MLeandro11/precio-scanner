import { describe, it, expect } from 'vitest'
import Fuse from 'fuse.js'
import {
  createEngine,
  runQuery,
  buildQueryPattern,
  escapeExtendedToken,
  mergeRanges,
  tokenizeQuery,
  FUSE_OPTIONS,
} from './searchEngine'
import type { Producto } from './types'

type WithMatches = Producto & { _matches: { nombre?: Array<[number, number]> } }

const PRODUCTS: Producto[] = [
  { id: '1', nombre: 'COCA COLA 1.75', marca: '', categoria: 'Bebidas', barcode: '7790895007217', precio: 6000 },
  { id: '2', nombre: 'COCA COLA 500 ML', marca: '', categoria: 'Bebidas', barcode: '100427', precio: 2500 },
  { id: '3', nombre: 'YERBA PLAYADITO 1KG', marca: '', categoria: 'Almacen', barcode: '', precio: 4800 },
  { id: '4', nombre: 'GASEOSA DE LA CASA 3L', marca: '', categoria: 'Bebidas', barcode: '7793621001234', precio: 1500 },
  { id: '5', nombre: 'FIDEOS MARTINOLI 500G', marca: '', categoria: 'Almacen', barcode: '7790895007217', precio: 3200 },
]

// Mirrors the production build: serialized Fuse.createIndex over ['nombre','categoria']
function buildIndex(products: Producto[]) {
  return JSON.parse(
    JSON.stringify(Fuse.createIndex(['nombre', 'categoria'], products)),
  )
}

function engine() {
  return createEngine(PRODUCTS, buildIndex(PRODUCTS))
}

describe('searchEngine', () => {
  it('finds products by fuzzy query (typo-tolerant, brand words in name)', () => {
    const r = runQuery(engine(), { query: 'cocacola' })
    expect(r.total).toBe(2)
    expect(r.results.map((p) => p.id).sort()).toEqual(['1', '2'])
  })

  it('matches a full EAN barcode exactly (priority over fuzzy)', () => {
    const r = runQuery(engine(), { query: '7790895007217' })
    // two products share this code in the fixture
    expect(r.total).toBe(2)
    expect(r.results.map((p) => p.id).sort()).toEqual(['1', '5'])
  })

  it('normalizes separators when matching a barcode', () => {
    const r = runQuery(engine(), { query: '7790-8950 0721.7' })
    expect(r.total).toBe(2)
  })

  it('does not treat short digit fragments as barcodes (name search wins)', () => {
    // '1.75' strips to 3 digits: below the barcode threshold → fuzzy path
    const r = runQuery(engine(), { query: '1.75' })
    expect(r.total).toBe(1)
    expect(r.results[0].id).toBe('1')
  })

  it('barcode-like query with no exact hit falls through to fuzzy (no false positives)', () => {
    const r = runQuery(engine(), { query: '1234567890123' })
    expect(r.total).toBe(0)
  })

  it('returns results + full total when paging', () => {
    const r = runQuery(engine(), { query: '', sort: 'price-asc', limit: 2, offset: 0 })
    expect(r.total).toBe(5)
    expect(r.results).toHaveLength(2)
    const page2 = runQuery(engine(), { query: '', sort: 'price-asc', limit: 2, offset: 2 })
    // pages do not overlap
    expect(page2.results.map((p) => p.id)).not.toEqual(r.results.map((p) => p.id))
  })

  it('no query lists all products in catalog order (category browsing)', () => {
    const r = runQuery(engine(), { query: '' })
    expect(r.total).toBe(5)
    expect(r.results.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('filters by category with and without query', () => {
    const browse = runQuery(engine(), { query: '', categoria: 'Almacen' })
    expect(browse.total).toBe(2)
    expect(browse.results.map((p) => p.id)).toEqual(['3', '5'])

    const searched = runQuery(engine(), { query: 'cocacola', categoria: 'Bebidas' })
    expect(searched.total).toBe(2)
  })

  it('filters by price range', () => {
    const r = runQuery(engine(), { query: '', priceMin: 2000, priceMax: 5000 })
    expect(r.results.map((p) => p.id)).toEqual(['2', '3', '5'])
  })

  it('sorts by price asc and desc', () => {
    const asc = runQuery(engine(), { query: '', sort: 'price-asc' })
    expect(asc.results.map((p) => p.precio)).toEqual([1500, 2500, 3200, 4800, 6000])
    const desc = runQuery(engine(), { query: '', sort: 'price-desc' })
    expect(desc.results.map((p) => p.precio)).toEqual([6000, 4800, 3200, 2500, 1500])
  })

  it('combines query + filters + sort + paging', () => {
    const r = runQuery(engine(), {
      query: 'bebida',
      categoria: 'Bebidas',
      sort: 'price-asc',
      limit: 1,
      offset: 1,
    })
    expect(r.results.length).toBeLessThanOrEqual(1)
  })

  it('returns fuse match positions for highlighting when a query is present', () => {
    const r = runQuery(engine(), { query: 'cocacola', limit: 1 })
    const first = r.results[0] as WithMatches
    expect(first._matches).toBeDefined()
    expect(Array.isArray(first._matches.nombre)).toBe(true)
    // indices are [start, end] char ranges within the nombre field (Fuse v7
    // may match partial tokens: each range covers exactly the matched chars)
    const nombre = PRODUCTS.find((p) => p.id === first.id)?.nombre ?? ''
    for (const [start, end] of first._matches.nombre!) {
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThanOrEqual(nombre.length)
      expect(end).toBeGreaterThan(start)
    }
  })

  it('does not add _matches when there is no query (browsing)', () => {
    const r = runQuery(engine(), { query: '' })
    expect((r.results[0] as WithMatches)._matches).toBeUndefined()
  })

  it('is resilient: unknown category yields empty results without throwing', () => {
    const r = runQuery(engine(), { query: '', categoria: 'No existe' })
    expect(r.total).toBe(0)
    expect(r.results).toEqual([])
  })

  it('restricts results and total to an explicit id set', () => {
    const r = runQuery(engine(), { query: '', ids: ['2', '4'] })
    expect(r.total).toBe(2)
    expect(r.results.map((p) => p.id)).toEqual(['2', '4'])
  })

  it('applies the ids filter to the fuzzy path too', () => {
    const r = runQuery(engine(), { query: 'cocacola', ids: ['1'] })
    expect(r.total).toBe(1)
    expect(r.results.map((p) => p.id)).toEqual(['1'])
  })

  it('ignores ids that match no product', () => {
    const r = runQuery(engine(), { query: '', ids: ['nope'] })
    expect(r.total).toBe(0)
    expect(r.results).toEqual([])
  })

  it('composes ids with category and price filters', () => {
    const byCategory = runQuery(engine(), {
      query: '',
      ids: ['1', '2', '3'],
      categoria: 'Bebidas',
    })
    expect(byCategory.total).toBe(2)
    expect(byCategory.results.map((p) => p.id)).toEqual(['1', '2'])

    const byPrice = runQuery(engine(), { query: '', ids: ['1', '2', '3'], priceMax: 3000 })
    expect(byPrice.total).toBe(1)
    expect(byPrice.results.map((p) => p.id)).toEqual(['2'])
  })

  it('treats an empty ids array as no filter (favorites must never blank the browse)', () => {
    const plain = runQuery(engine(), { query: '' })
    const empty = runQuery(engine(), { query: '', ids: [] })
    expect(empty.total).toBe(plain.total)
    expect(empty.results.map((p) => p.id)).toEqual(plain.results.map((p) => p.id))
  })

  it('does not break paging when ids is set', () => {
    const ids = ['1', '2', '3', '4', '5']
    const page1 = runQuery(engine(), { query: '', ids, sort: 'price-asc', limit: 2, offset: 0 })
    expect(page1.total).toBe(5)
    expect(page1.results.map((p) => p.id)).toEqual(['4', '2'])

    const page2 = runQuery(engine(), { query: '', ids, sort: 'price-asc', limit: 2, offset: 2 })
    expect(page2.results.map((p) => p.id)).toEqual(['5', '3'])

    const page3 = runQuery(engine(), { query: '', ids, sort: 'price-asc', limit: 2, offset: 4 })
    expect(page3.total).toBe(5)
    expect(page3.results.map((p) => p.id)).toEqual(['1'])
  })
})

// ------------------------------------------------- task 7.7: multi-word queries mean AND
//
// Every fixture below is local to these tests: the shared PRODUCTS fixture and the 18
// existing cases stay untouched.

const MULTI_PRODUCTS: Producto[] = [
  { id: 'm1', nombre: 'COCA COLA ZERO 1,5L', marca: '', categoria: 'Bebidas', barcode: '', precio: 3000 },
  { id: 'm2', nombre: 'ZERO GRANADINA 1,5L', marca: '', categoria: 'Bebidas', barcode: '', precio: 1200 },
  { id: 'm3', nombre: 'COCA COLA 2,25L', marca: '', categoria: 'Bebidas', barcode: '', precio: 2500 },
  // Names that literally carry Fuse's extended-search metacharacters: the equivalence
  // test below proves they stay literal.
  { id: 'm4', nombre: "ARROLLADO DE CARNE 'PALADINI'", marca: '', categoria: 'Almacen', barcode: '', precio: 4000 },
  { id: 'm5', nombre: 'ACTIVIA CHIA&MANGO$MARACUYA X 185G', marca: '', categoria: 'Almacen', barcode: '', precio: 1800 },
  { id: 'm6', nombre: 'STOP! BARRITA DE CEREAL', marca: '', categoria: 'Almacen', barcode: '', precio: 900 },
  { id: 'm7', nombre: 'PRODUCTO =UNO', marca: '', categoria: 'Almacen', barcode: '', precio: 700 },
]

const NUL_PRODUCTS: Producto[] = [
  { id: 'n1', nombre: 'PRODUCTO COCA', marca: '', categoria: 'Prueba', barcode: '', precio: 100 },
  { id: 'n2', nombre: 'PRODUCTO ZERO', marca: '', categoria: 'Prueba', barcode: '', precio: 200 },
  { id: 'n3', nombre: 'PRODUCTO COCA ZERO', marca: '', categoria: 'Prueba', barcode: '', precio: 300 },
]

function multiEngine() {
  return createEngine(MULTI_PRODUCTS, buildIndex(MULTI_PRODUCTS))
}

function multiReference() {
  // Same products and the same serialized index as the shipped engine, only the pre-7.7
  // parser. This is the behaviour a single token must not change.
  return new Fuse<Producto>(
    MULTI_PRODUCTS,
    { ...FUSE_OPTIONS, useExtendedSearch: false },
    Fuse.parseIndex<Producto>(buildIndex(MULTI_PRODUCTS)),
  )
}

describe('multi-word queries (task 7.7)', () => {
  it('matches ALL the words: one unmatched word excludes the product', () => {
    const r = runQuery(multiEngine(), { query: 'coca 1,5' })
    // m1 has both words; m2 has only 1,5 and m3 has only coca
    expect(r.total).toBe(1)
    expect(r.results.map((p) => p.id)).toEqual(['m1'])
  })

  it('does not turn a single word into a filter (single-token control)', () => {
    const r = runQuery(multiEngine(), { query: 'coca' })
    expect(r.total).toBe(2)
    expect(r.results.map((p) => p.id).sort()).toEqual(['m1', 'm3'])
  })

  it('keeps every single token literal (equivalence with the pre-7.7 raw engine)', () => {
    const reference = multiReference()
    const adversarial = [
      '!coca',
      '=coca',
      "'coca",
      '^coca',
      'coca$',
      'coca|zero',
      '"a"',
      'a"b',
      '\\',
      'PALADINI',
      "'PALADINI'",
      'MANGO$MARACUYA',
      'STOP!',
      '=UNO',
      'COCA',
      '1,5',
      '2,25',
    ]
    for (const token of adversarial) {
      const shipped = runQuery(multiEngine(), { query: token, limit: 50 })
      const raw = reference.search(token, { limit: 50 })
      expect({ token, total: shipped.total }).toEqual({ token, total: raw.length })
      // id sets, not order: tie ordering is not part of the contract
      expect(new Set(shipped.results.map((p) => p.id))).toEqual(
        new Set(raw.map((r) => r.item.id)),
      )
    }
  })

  it('builds one neutralized literal term per token and never a browse-all pattern', () => {
    expect(buildQueryPattern('coca 2,5')).toBe('"coca" "2,5"')
    expect(buildQueryPattern('coca\u0000zero')).toBe('"coca" "zero"')
    expect(escapeExtendedToken('coca|zero')).toBe('"coca\\|zero"')
    expect(tokenizeQuery(' a\tb\u007fc ')).toEqual(['a', 'b', 'c'])
    // empty and control-only queries yield no pattern, so there is nothing to search
    expect(buildQueryPattern('')).toBe('')
    expect(buildQueryPattern('   ')).toBe('')
    expect(buildQueryPattern('\u0000\u001f')).toBe('')
  })

  it('treats a control character as a separator, never an OR operator', () => {
    // A raw NUL would reach Fuse's parser as `|`: `coca|zero` is an OR and would return
    // all three products. Tokenized, it is coca AND zero -> only n3.
    const r = runQuery(createEngine(NUL_PRODUCTS, buildIndex(NUL_PRODUCTS)), {
      query: 'coca\u0000zero',
    })
    expect(r.total).toBe(1)
    expect(r.results.map((p) => p.id)).toEqual(['n3'])
  })

  it('returns nothing for a query made only of control characters (never a browse-all)', () => {
    const r = runQuery(createEngine(NUL_PRODUCTS, buildIndex(NUL_PRODUCTS)), {
      query: '\u0000',
    })
    expect(r.total).toBe(0)
    expect(r.results).toEqual([])
  })

  it('is strict: a two-token query with one unmatched token yields zero (no silent OR)', () => {
    const r = runQuery(multiEngine(), { query: 'coca zzzzz' })
    expect(r.total).toBe(0)
    expect(r.results).toEqual([])
  })

  it('keeps the browse-all for a whitespace-only query', () => {
    const r = runQuery(multiEngine(), { query: '   ' })
    expect(r.total).toBe(MULTI_PRODUCTS.length)
  })

  it('emits sorted, non-overlapping positions covering both words for a two-token query', () => {
    const r = runQuery(multiEngine(), { query: 'coca 1,5', limit: 1 })
    const first = r.results[0] as WithMatches
    const ranges = first._matches.nombre!
    expect(ranges.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < ranges.length; i += 1) {
      // sorted and disjoint: no duplicated range can render its text twice
      expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][1])
    }
    const nombre = MULTI_PRODUCTS.find((p) => p.id === first.id)!.nombre
    const covered = (from: number, to: number) => ranges.some(([s, e]) => s <= to && e >= from)
    const cocaAt = nombre.indexOf('COCA')
    const volumeAt = nombre.indexOf('1,5')
    expect(cocaAt).toBeGreaterThanOrEqual(0)
    expect(volumeAt).toBeGreaterThanOrEqual(0)
    expect(covered(cocaAt, cocaAt + 3)).toBe(true)
    expect(covered(volumeAt, volumeAt + 2)).toBe(true)
  })

  it('composes a two-token query with category, price, ids, paging and sort', () => {
    const r = runQuery(multiEngine(), {
      query: 'coca cola',
      categoria: 'Bebidas',
      priceMin: 1000,
      priceMax: 3500,
      ids: ['m1', 'm2', 'm3'],
      sort: 'price-asc',
      limit: 1,
      offset: 1,
    })
    // m1 (3000) and m3 (2500) carry both words; price-asc puts m3 first, so offset 1 is m1
    expect(r.total).toBe(2)
    expect(r.results.map((p) => p.id)).toEqual(['m1'])

    const restricted = runQuery(multiEngine(), {
      query: 'coca cola',
      ids: ['m1'],
      sort: 'price-asc',
    })
    expect(restricted.total).toBe(1)
    expect(restricted.results.map((p) => p.id)).toEqual(['m1'])
  })

  it('mergeRanges sorts, merges overlapping and touching ranges, keeps disjoint ones', () => {
    expect(mergeRanges([])).toEqual([])
    expect(mergeRanges([[3, 4]])).toEqual([[3, 4]])
    expect(mergeRanges([[10, 12], [0, 1], [2, 5], [1, 3], [20, 21], [6, 6]])).toEqual([
      [0, 6],
      [10, 12],
      [20, 21],
    ])
    // pure: the caller's array is not reordered or mutated
    const input: Array<[number, number]> = [
      [5, 6],
      [0, 1],
    ]
    mergeRanges(input)
    expect(input).toEqual([
      [5, 6],
      [0, 1],
    ])
  })
})
