import { describe, it, expect, vi } from 'vitest'
import { createWorkerClient } from './workerClient'
import type { WorkerLike } from './workerClient'

type SentMessage = {
  type: string
  id?: number
  /** init: catalog array; resolved: product map — two protocols share the name. */
  products?: unknown
  query?: string
  limit?: number
  offset?: number
  eans?: string[]
  ids?: string[]
  results?: unknown
  total?: number
}

/** Minimal fake Worker that satisfies WorkerLike plus a `respond` helper. */
function fakeWorker(): WorkerLike & {
  sent: SentMessage[]
  respond: (msg: SentMessage) => void
} {
  const listeners: Record<string, Array<(e: { data: SentMessage }) => void>> = {}
  const sent: SentMessage[] = []
  return {
    sent,
    postMessage(message: unknown) {
      sent.push(message as SentMessage)
    },
    addEventListener(type, fn) {
      ;(listeners[type] ??= []).push(fn as (e: { data: SentMessage }) => void)
    },
    respond(msg) {
      listeners.message?.forEach((fn) => fn({ data: msg }))
    },
  }
}

function readySetup() {
  const worker = fakeWorker()
  const client = createWorkerClient({ workerFactory: () => worker })
  const initPromise = client.init({
    products: [{ id: '1', nombre: 'N', marca: '', categoria: 'C', barcode: '', precio: 1 }],
    index: { keys: [], fuseIndex: {} },
    facets: { version: 'v1' },
  })
  worker.respond({ type: 'ready' })
  return { worker, client, initPromise }
}

describe('workerClient', () => {
  it('init posts the catalog data once and resolves on worker ready', async () => {
    const { worker, initPromise } = readySetup()
    await initPromise
    expect(worker.sent).toHaveLength(1)
    expect(worker.sent[0]!.type).toBe('init')
    expect(worker.sent[0]!.products as unknown[]).toHaveLength(1)
  })

  it('sends query messages with a generation id and resolves with matching results', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const promise = client.query({ query: 'coca', limit: 50, offset: 0 })
    const msg = worker.sent.find((m) => m.type === 'query')!
    expect(msg.id).toEqual(expect.any(Number))
    worker.respond({ type: 'results', id: msg.id, results: [{ id: '1' }], total: 1 })

    const r = await promise
    expect(r.results).toEqual([{ id: '1' }])
    expect(r.total).toBe(1)
  })

  it('discards stale responses and supersedes the older query (generation counter)', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const q1 = client.query({ query: 'first' })
    const q2 = client.query({ query: 'second' })

    const id1 = worker.sent.filter((m) => m.type === 'query')[0]!.id as number
    const id2 = worker.sent.filter((m) => m.type === 'query')[1]!.id as number
    expect(id2).toBeGreaterThan(id1)

    // late response for the superseded query: q1 must reject, not resolve
    worker.respond({ type: 'results', id: id1, results: ['stale'], total: 99 })
    await expect(q1).rejects.toThrow(/superseded/i)

    // response for the current generation resolves
    worker.respond({ type: 'results', id: id2, results: ['fresh'], total: 1 })
    await expect(q2).resolves.toEqual({ results: ['fresh'], total: 1 })
  })

  it('ignores results with unknown ids (never resolves a different generation)', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const promise = client.query({ query: 'x' })
    worker.respond({ type: 'results', id: 99999, results: ['garbage'], total: 0 })

    let settled = false
    promise.then(() => undefined, () => undefined).then(() => {
      settled = true
    })
    await vi.waitFor(() => undefined) // let microtasks run
    expect(settled).toBe(false)

    const msg = worker.sent.find((m) => m.type === 'query')!
    worker.respond({ type: 'results', id: msg.id, results: ['ok'], total: 1 })
    await expect(promise).resolves.toEqual({ results: ['ok'], total: 1 })
  })

  it('resolveMany sends ONE message for the whole burst and resolves with the product map', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const promise = client.resolveMany({ eans: ['7790710000102'], ids: ['sin-ean'] })
    const resolveMsgs = worker.sent.filter((m) => m.type === 'resolve')
    expect(resolveMsgs).toHaveLength(1)
    expect(resolveMsgs[0]!.eans).toEqual(['7790710000102'])
    expect(resolveMsgs[0]!.ids).toEqual(['sin-ean'])

    worker.respond({
      type: 'resolved',
      id: resolveMsgs[0]!.id,
      products: { '7790710000102': { id: '1', nombre: 'Yerba', barcode: '7790710000102' } },
    })
    await expect(promise).resolves.toEqual({
      '7790710000102': { id: '1', nombre: 'Yerba', barcode: '7790710000102' },
    })
  })

  it('discards resolved responses for unknown generations', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const promise = client.resolveMany({ eans: ['7790710000102'] })
    worker.respond({ type: 'resolved', id: 424242, products: { x: { id: 'stale' } } })

    let settled = false
    promise.then(() => undefined, () => undefined).then(() => {
      settled = true
    })
    await vi.waitFor(() => undefined)
    expect(settled).toBe(false)

    const msg = worker.sent.find((m) => m.type === 'resolve')!
    worker.respond({ type: 'resolved', id: msg.id, products: {} })
    await expect(promise).resolves.toEqual({})
  })

  it('resolveMany does NOT supersede a pending search query (separate pools)', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const queryPromise = client.query({ query: 'yerba' })
    const resolvePromise = client.resolveMany({ eans: ['7790710000102'] })

    // the query stays pending — the resolve burst must not reject it
    worker.respond({
      type: 'resolved',
      id: worker.sent.find((m) => m.type === 'resolve')!.id,
      products: {},
    })
    await expect(resolvePromise).resolves.toEqual({})

    const queryMsg = worker.sent.find((m) => m.type === 'query')!
    worker.respond({ type: 'results', id: queryMsg.id, results: ['hit'], total: 1 })
    await expect(queryPromise).resolves.toEqual({ results: ['hit'], total: 1 })
  })
})