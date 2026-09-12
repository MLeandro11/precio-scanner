import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSearchSession } from './searchSession.mjs'

function fakeClient() {
  return {
    calls: [],
    async query(params) {
      this.calls.push(params)
      const offset = params.offset ?? 0
      // respect the total: fewer results on the last page
      const n = Math.min(params.limit, 120 - offset)
      return {
        results: Array.from({ length: n }, (_, i) => ({
          id: `p${offset + i}`,
          nombre: `Prod ${offset + i}`,
          marca: '',
          categoria: 'C',
          precio: offset + i,
        })),
        total: 120,
      }
    },
  }
}

function setup(deps = {}) {
  const client = fakeClient()
  const session = createSearchSession({ client, ...deps })
  const states = []
  session.subscribe((s) => states.push(s))
  return { client, session, states }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('searchSession', () => {
  it('runs an initial browse query at creation (empty query, page 0)', async () => {
    const { client, session, states } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))
    expect(client.calls[0].query).toBe('')
    const final = session.getState()
    expect(final.results).toHaveLength(50)
    expect(final.total).toBe(120)
    expect(final.loading).toBe(false)
    expect(final.hasMore).toBe(true)
  })

  it('debounces rapid query typing (150 ms) into a single run', async () => {
    vi.useFakeTimers()
    const { client, session, states } = setup()

    session.setQuery('c')
    session.setQuery('co')
    session.setQuery('coc')
    expect(states[states.length - 1].query).toBe('coc')
    // nothing ran yet
    expect(client.calls).toHaveLength(1) // only the initial browse

    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(client.calls.filter((c) => c.query === 'coc')).toHaveLength(1)
  })

  it('swallows superseded worker rejections (fast typing never breaks the UI)', async () => {
    vi.useFakeTimers()
    const client = fakeClient()
    client.query = vi.fn(async (p) => {
      if (p.query === 'lento') {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error('query superseded by generation 9')), 50),
        )
      }
      return { results: [], total: 0 }
    })
    const session = createSearchSession({ client })
    session.setQuery('lento')
    vi.advanceTimersByTime(200)
    await vi.runAllTimersAsync()
    expect(session.getState().error).toBeNull()
    expect(session.getState().loading).toBe(false)
  })

  it('exposes real errors (not supersession) as state.error', async () => {
    vi.useFakeTimers()
    const client = fakeClient()
    client.query = vi.fn(async () => {
      throw new Error('worker crashed')
    })
    const session = createSearchSession({ client })
    session.setQuery('algo')
    vi.advanceTimersByTime(200)
    await vi.runAllTimersAsync()
    expect(session.getState().error).toEqual(new Error('worker crashed'))
  })

  it('loadMore appends the next page and clears hasMore at the end', async () => {
    const { session, states } = setup()
    await vi.waitFor(() => expect(session.getState().results).toHaveLength(50))

    session.loadMore()
    await vi.waitFor(() => expect(session.getState().results).toHaveLength(100))
    session.loadMore()
    await vi.waitFor(() => expect(session.getState().results).toHaveLength(120))
    expect(session.getState().hasMore).toBe(false)
    // no duplicate products in the accumulated list
    const ids = session.getState().results.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(120)
  })

  it('filters and sort run immediately (no debounce)', async () => {
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.setFilters({ categoria: 'Bebidas' })
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))
    expect(client.calls[1].categoria).toBe('Bebidas')

    session.setSort('price-asc')
    await vi.waitFor(() => expect(client.calls).toHaveLength(3))
    expect(client.calls[2].sort).toBe('price-asc')
  })

  it('new query resets paging (append starts from a clean page)', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(session.getState().results).toHaveLength(50))
    session.setQuery('coca')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    const lastCall = client.calls[client.calls.length - 1]
    expect(lastCall.offset ?? 0).toBe(0)
    expect(session.getState().results).toHaveLength(50)
  })
})
