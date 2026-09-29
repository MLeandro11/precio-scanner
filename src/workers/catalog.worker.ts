/**
 * catalog.worker — the worker owns the catalog and the Fuse index (spec FR-2.2).
 *
 * Messages in:
 *   { type: 'init', products, index, facets }   → replies { type: 'ready' }
 *   { type: 'query', id, query, categoria,
 *     priceMin, priceMax, sort, limit, offset } → replies { type: 'results',
 *     id, results (≤ limit), total }
 *   { type: 'resolve', id, eans?, ids? }        → replies { type: 'resolved',
 *     id, products } — exact barcode/id lookup for list views, one round-trip
 *     for the whole burst (see useResolveEans).
 *
 * All the heavy logic lives in src/lib/searchEngine.ts (unit-tested there);
 * this file is a thin message adapter.
 */
import { createEngine, runQuery } from '../lib/searchEngine'
import type { Producto, WorkerInMessage } from '../lib/types'
import type { Engine } from '../lib/searchEngine'

const ctx = globalThis as unknown as DedicatedWorkerGlobalScope

let engine: Engine | null = null

ctx.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data

  if (msg.type === 'init') {
    engine = createEngine(msg.products, msg.index)
    ctx.postMessage({ type: 'ready' })
    return
  }

  if (msg.type === 'query' && engine) {
    const { results, total } = runQuery(engine, msg)
    ctx.postMessage({ type: 'results', id: msg.id, results, total })
  }

  if (msg.type === 'resolve' && engine) {
    const products: Record<string, Producto> = {}
    // Exact barcode path: the engine's barcodeMap is keyed by the stored
    // barcode digits, so this is the same exact match the search pipeline's
    // barcode branch uses — no fuzzy, no scoring, no inventing near-misses.
    // Incoming EANs are reduced to digits first (the search path's rule).
    for (const ean of msg.eans ?? []) {
      const digits = ean.replace(/\D/g, '')
      const hit = digits ? engine.barcodeMap.get(digits) : undefined
      if (hit && hit.length) products[ean] = hit[0]!
    }
    // Catalog-id path: same identity lookup the favorites-mode filter uses.
    for (const id of msg.ids ?? []) {
      const hit = engine.products.find((p) => p.id === id)
      if (hit) products[id] = hit
    }
    ctx.postMessage({ type: 'resolved', id: msg.id, products })
  }
}