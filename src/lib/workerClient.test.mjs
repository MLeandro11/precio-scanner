import { describe, it, expect, vi } from 'vitest'
import { createWorkerClient } from './workerClient.mjs'

function fakeWorker() {
  const listeners = {}
  const sent = []
  return {
    sent,
    postMessage(msg) {
      sent.push(msg)
    },
    addEventListener(type, fn) {
      ;(listeners[type] ??= []).push(fn)
    },
    // test helper: emulate a worker response
    respond(msg) {
      listeners.message?.forEach((fn) => fn({ data: msg }))
    },
  }
}

function readySetup() {
  const worker = fakeWorker()
  const client = createWorkerClient({ workerFactory: () => worker })
  const initPromise = client.init({
    products: [{ id: '1', nombre: 'N', marca: '', categoria: 'C', precio: 1 }],
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
    expect(worker.sent[0].type).toBe('init')
    expect(worker.sent[0].products).toHaveLength(1)
  })

  it('sends query messages with a generation id and resolves with matching results', async () => {
    const { worker, client } = readySetup()
    await client.ready

    const promise = client.query({ query: 'coca', limit: 50, offset: 0 })
    const msg = worker.sent.find((m) => m.type === 'query')
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

    const id1 = worker.sent.filter((m) => m.type === 'query')[0].id
    const id2 = worker.sent.filter((m) => m.type === 'query')[1].id
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
    promise.then(() => {}, () => {}).then(() => {
      settled = true
    })
    await vi.waitFor(() => {}) // let microtasks run
    expect(settled).toBe(false)

    const msg = worker.sent.find((m) => m.type === 'query')
    worker.respond({ type: 'results', id: msg.id, results: ['ok'], total: 1 })
    await expect(promise).resolves.toEqual({ results: ['ok'], total: 1 })
  })
})
