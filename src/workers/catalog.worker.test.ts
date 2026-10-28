import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Fuse from 'fuse.js'
import type { Producto, WorkerOutMessage } from '../lib/types'

/**
 * The worker module registers itself by assigning onto `globalThis` (its `ctx`)
 * and has no exports, so importing it IS the registration. These tests grab the
 * handler from the same global the production code writes to and drive it with
 * synthetic MessageEvents: the production handler is under test, not a
 * re-implementation of it. The module keeps its engine in module state and
 * re-initialising it inside each test keeps the tests order-independent.
 */

const P1: Producto = { id: '1', nombre: 'COCA COLA 500 ML', marca: '', categoria: 'Bebidas', barcode: '7793621001234', precio: 1500 }
const P2: Producto = { id: '2', nombre: 'FIDEOS MARTINOLI 500G', marca: '', categoria: 'Almacen', barcode: '7790895007217', precio: 3200 }
const P3: Producto = { id: '3', nombre: 'YERBA PLAYADITO 1KG', marca: '', categoria: 'Almacen', barcode: '', precio: 4800 }

function seedIndex(products: Producto[]): unknown {
  // Same shape the production index ships: Fuse.createIndex, serialized.
  return JSON.parse(JSON.stringify(Fuse.createIndex(['nombre', 'categoria'], products)))
}

let posted: WorkerOutMessage[] = []

function send(msg: unknown) {
  const target = globalThis as unknown as { onmessage?: (e: { data: unknown }) => void }
  target.onmessage!({ data: msg })
}

beforeAll(async () => {
  // The adapter reports back through ctx.postMessage — capture it here.
  ;(globalThis as unknown as { postMessage: (m: WorkerOutMessage) => void }).postMessage = (m) => {
    posted.push(m)
  }
  // Importing the module is what runs `ctx.onmessage = ...`
  await import('../workers/catalog.worker')
})

beforeEach(() => {
  posted.length = 0 // same array identity the beforeAll handler captured
  send({ type: 'init', products: [P1, P2, P3], index: seedIndex([P1, P2, P3]), facets: { version: 'v' } })
})

describe('catalog worker adapter', () => {
  it('replies ready once init carries the catalog data', () => {
    expect(posted).toHaveLength(1)
    expect(posted[0]!.type).toBe('ready')
  })

  it('resolve maps each incoming EAN to its product (digits-normalized, like search)', () => {
    send({
      type: 'resolve',
      id: 7,
      eans: ['7793 6210 01234', P2.barcode], // P1's digits with separators, then P2 exact
      ids: ['3'], // P3 has no barcode: only the id path can find it
    })
    // beforeEach already emitted `ready`; the resolve appends `resolved`.
    expect(posted.map((m) => m.type)).toEqual(['ready', 'resolved'])
    const resolved = posted[1]!
    expect((resolved as unknown as { id: number }).id).toBe(7)
    expect((resolved as unknown as { products: Record<string, Producto> }).products).toEqual({
      '7793 6210 01234': P1,
      [P2.barcode]: P2,
      '3': P3,
    })
  })

  it('resolve omits unknown keys instead of inventing a near-miss', () => {
    send({ type: 'resolve', id: 9, eans: ['1111111111111'], ids: ['nope'] })
    expect(posted.map((m) => m.type)).toEqual(['ready', 'resolved'])
    expect((posted[1] as unknown as { products: Record<string, unknown> }).products).toEqual({})
  })

  it('resolve takes the LAST catalog row for a repeated EAN, the rule the history log writes with', () => {
    // 88 EANs ship more than one row in catalogo.json, sometimes with different
    // prices. The history series closes with "today's price" chosen as the last
    // row (spec S6), so the resolver has to hand that row over, not the first.
    const viejo = { ...P1, id: '1-viejo', precio: 19496 }
    const nuevo = { ...P1, id: '1-nuevo', precio: 19500 }
    send({ type: 'init', products: [viejo, nuevo], index: seedIndex([viejo, nuevo]), facets: { version: 'v' } })
    send({ type: 'resolve', id: 11, eans: [P1.barcode] })
    const resolved = posted[posted.length - 1] as unknown as {
      products: Record<string, Producto>
    }
    expect(resolved.products[P1.barcode]).toEqual(nuevo)
  })
})
