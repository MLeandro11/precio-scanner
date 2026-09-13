/**
 * catalog.worker — the worker owns the catalog and the Fuse index (spec FR-2.2).
 *
 * Messages in:
 *   { type: 'init', products, index, facets }   → replies { type: 'ready' }
 *   { type: 'query', id, query, categoria,
 *     priceMin, priceMax, sort, limit, offset } → replies { type: 'results',
 *     id, results (≤ limit), total }
 *
 * All the heavy logic lives in src/lib/searchEngine.ts (unit-tested there);
 * this file is a thin message adapter.
 */
import { createEngine, runQuery } from '../lib/searchEngine'
import type { WorkerInMessage } from '../lib/types'
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
}