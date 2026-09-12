/**
 * workerClient — main-thread handle to the catalog worker.
 *
 * Contract (spec FR-2.2, design §Large-catalog client handling):
 *   - init(payload): sends the catalog data to the worker once; resolves when
 *     the worker reports ready.
 *   - query(params): promise-based search. Each query gets an incrementing
 *     generation id; when a new query supersedes a pending one, the old
 *     promise rejects ('superseded') and late responses for old generations
 *     are discarded — fast typing never renders stale results.
 *
 * The Worker is injectable (workerFactory) so tests run without a browser.
 */
function defaultWorkerFactory() {
  return new Worker(new URL('../workers/catalog.worker.js', import.meta.url), {
    type: 'module',
  })
}

export function createWorkerClient({ workerFactory = defaultWorkerFactory } = {}) {
  const worker = workerFactory()
  let readyResolve
  const ready = new Promise((resolve) => {
    readyResolve = resolve
  })

  let nextId = 0
  let pending = null // { id, resolve, reject }

  worker.addEventListener('message', (e) => {
    const msg = e.data
    if (msg.type === 'ready') {
      readyResolve()
      return
    }
    if (msg.type === 'results') {
      if (pending && msg.id === pending.id) {
        const { resolve } = pending
        pending = null
        resolve({ results: msg.results, total: msg.total })
      }
      // unknown/old generation → silently discarded
    }
  })

  return {
    ready,
    init(payload) {
      worker.postMessage({ type: 'init', ...payload })
      return ready
    },
    query(params) {
      const id = ++nextId
      if (pending) {
        const { reject } = pending
        pending = null
        reject(new Error(`query superseded by generation ${id}`))
      }
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject }
        worker.postMessage({ type: 'query', id, ...params })
      })
    },
  }
}
