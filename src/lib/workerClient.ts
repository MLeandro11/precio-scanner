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
import type {
  Producto,
  QueryParams,
  QueryResult,
  WorkerOutMessage,
  WorkerResolvedMessage,
} from './types'

/** Minimo del Worker que workerClient usa (inyectable en tests). */
export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(
    type: string,
    listener: (event: MessageEvent<WorkerOutMessage>) => void,
  ): void
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL('../workers/catalog.worker.ts', import.meta.url), {
    type: 'module',
  })
}

interface InitPayload {
  products: Producto[]
  index?: unknown
  facets?: unknown
}

interface Pending<T = QueryResult> {
  id: number
  resolve: (result: T) => void
  reject: (err: Error) => void
}

export function createWorkerClient({
  workerFactory = defaultWorkerFactory,
}: { workerFactory?: () => WorkerLike } = {}) {
  const worker = workerFactory()
  let readyResolve: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve
  })

  let nextId = 0
  let pending: Pending | null = null
  // Resolve requests have their own pool: they are list-view lookups, not the
  // interactive search stream, so they do NOT supersede a pending search query
  // and several may be in flight (one per list change; the hook only issues
  // one burst per change, so in practice this stays a single entry).
  const resolvePending = new Map<number, Pending<Record<string, Producto>>>()

  worker.addEventListener('message', (e: MessageEvent<WorkerOutMessage>) => {
    const msg = e.data
    if (msg.type === 'ready') {
      readyResolve?.()
      return
    }
    if (msg.type === 'resolved') {
      const p = resolvePending.get(msg.id)
      if (p) {
        resolvePending.delete(msg.id)
        p.resolve((msg as WorkerResolvedMessage).products)
      }
      // unknown/old generation → silently discarded
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
    init(payload: InitPayload): Promise<void> {
      worker.postMessage({ type: 'init', ...payload })
      return ready
    },
    query(params: QueryParams): Promise<QueryResult> {
      const id = ++nextId
      if (pending) {
        pending.reject(new Error(`query superseded by generation ${id}`))
        pending = null
      }
      return new Promise<QueryResult>((resolve, reject) => {
        pending = { id, resolve, reject }
        worker.postMessage({ type: 'query', id, ...params })
      })
    },
    /**
     * One round-trip for a whole list of EANs/ids (see useResolveEans).
     * `ids` here is the catalog-id path (barcode-less items) — it is NOT the
     * favorites-mode filter of `query`; the worker answers exact lookups.
     */
    resolveMany(params: { eans?: string[]; ids?: string[] }): Promise<Record<string, Producto>> {
      const id = ++nextId
      return new Promise<Record<string, Producto>>((resolve, reject) => {
        resolvePending.set(id, { id, resolve, reject })
        worker.postMessage({ type: 'resolve', id, ...params })
      })
    },
  }
}

export type WorkerClient = ReturnType<typeof createWorkerClient>