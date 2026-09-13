/**
 * catalog.worker — the worker owns the catalog and the Fuse index (spec FR-2.2).
 *
 * Messages in:
 *   { type: 'init', products, index, facets }   → replies { type: 'ready' }
 *   { type: 'query', id, query, categoria,
 *     priceMin, priceMax, sort, limit, offset } → replies { type: 'results',
 *     id, results (≤ limit), total }
 *
 * All the heavy logic lives in src/lib/searchEngine.mjs (unit-tested there);
 * this file is a thin message adapter.
 */
import { createEngine, runQuery } from '../lib/searchEngine.mjs'

let engine = null

self.onmessage = (e) => {
  const msg = e.data

  if (msg.type === 'init') {
    engine = createEngine(msg.products, msg.index, msg.facets)
    self.postMessage({ type: 'ready' })
    return
  }

  if (msg.type === 'query' && engine) {
    const { results, total } = runQuery(engine, msg)
    self.postMessage({ type: 'results', id: msg.id, results, total })
  }
}
