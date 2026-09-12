import { describe, it, expect } from 'vitest'
import Fuse from 'fuse.js'
import { createEngine, runQuery } from './searchEngine.mjs'

const PRODUCTS = [
  { id: '1', nombre: 'COCA COLA 1.75', marca: '', categoria: 'Bebidas', barcode: '7790895007217', precio: 6000 },
  { id: '2', nombre: 'COCA COLA 500 ML', marca: '', categoria: 'Bebidas', barcode: '100427', precio: 2500 },
  { id: '3', nombre: 'YERBA PLAYADITO 1KG', marca: '', categoria: 'Almacen', barcode: '', precio: 4800 },
  { id: '4', nombre: 'GASEOSA DE LA CASA 3L', marca: '', categoria: 'Bebidas', barcode: '7793621001234', precio: 1500 },
  { id: '5', nombre: 'FIDEOS MARTINOLI 500G', marca: '', categoria: 'Almacen', barcode: '7790895007217', precio: 3200 },
]

// Mirrors the production build: serialized Fuse.createIndex over ['nombre','categoria']
function buildIndex(products) {
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
    const first = r.results[0]
    expect(first._matches).toBeDefined()
    expect(Array.isArray(first._matches.nombre)).toBe(true)
    // indices are [start, end] char ranges within the nombre field (Fuse v7
    // may match partial tokens: each range covers exactly the matched chars)
    const nombre = PRODUCTS.find((p) => p.id === first.id).nombre
    for (const [start, end] of first._matches.nombre) {
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThanOrEqual(nombre.length)
      expect(end).toBeGreaterThan(start)
    }
  })

  it('does not add _matches when there is no query (browsing)', () => {
    const r = runQuery(engine(), { query: '' })
    expect(r.results[0]._matches).toBeUndefined()
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
