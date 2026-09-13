import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSearchSession } from './searchSession'
import type { SearchState, QueryClient } from './searchSession'
import type { Producto, QueryParams, QueryResult } from './types'

type TestClient = QueryClient & { calls: QueryParams[] }

function fakeClient(): TestClient {
  return {
    calls: [],
    query(params: QueryParams): Promise<QueryResult> {
      this.calls.push(params)
      const offset = params.offset ?? 0
      // respect the total: fewer results on the last page
      const n = Math.min(params.limit ?? 50, 120 - offset)
      const results: Producto[] = Array.from({ length: n }, (_, i) => ({
        id: `p${offset + i}`,
        nombre: `Prod ${offset + i}`,
        marca: '',
        categoria: 'C',
        barcode: '',
        precio: offset + i,
      }))
      return Promise.resolve({ results, total: 120 })
    },
  }
}

function setup(deps: { limit?: number; onQueryCommit?: (q: string) => void } = {}) {
  const client = fakeClient()
  const session = createSearchSession({ client, ...deps })
  const states: SearchState[] = []
  session.subscribe((s) => states.push(s))
  return { client, session, states }
}

type AnyClient = TestClient & { query: ReturnType<typeof vi.fn> }

afterEach(() => {
  vi.useRealTimers()
})

describe('searchSession', () => {
  it('runs an initial browse query at creation (empty query, page 0)', async () => {
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))
    expect(client.calls[0]!.query).toBe('')
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
    expect(states[states.length - 1]!.query).toBe('coc')
    // nothing ran yet
    expect(client.calls).toHaveLength(1) // only the initial browse

    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(client.calls.filter((c) => c.query === 'coc')).toHaveLength(1)
  })

  it('swallows superseded worker rejections (fast typing never breaks the UI)', async () => {
    vi.useFakeTimers()
    const client = fakeClient() as AnyClient
    client.query = vi.fn(async (p: QueryParams) => {
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
    const client = fakeClient() as AnyClient
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
    const { session } = setup()
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
    expect(client.calls[1]!.categoria).toBe('Bebidas')

    session.setSort('price-asc')
    await vi.waitFor(() => expect(client.calls).toHaveLength(3))
    expect(client.calls[2]!.sort).toBe('price-asc')
  })

  it('new query resets paging (append starts from a clean page)', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(session.getState().results).toHaveLength(50))
    session.setQuery('coca')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    const lastCall = client.calls[client.calls.length - 1]!
    expect(lastCall.offset ?? 0).toBe(0)
    expect(session.getState().results).toHaveLength(50)
  })

  it('showFavorites sends the ids, clears the query and skips the debounce', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.setQuery('coca') // leaves a debounced run pending
    session.showFavorites(['2', '3'])
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))

    const favoritesCall = client.calls[1]!
    expect(favoritesCall.ids).toEqual(['2', '3'])
    expect(favoritesCall.query).toBe('')
    expect(session.getState()).toMatchObject({ ids: ['2', '3'], query: '' })

    // the pending debounced query was cancelled: favorites run exactly once
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(client.calls).toHaveLength(2)
  })

  it('showFavorites(null) leaves favorites mode and restores the normal browse', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.showFavorites(['1', '2'])
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))
    session.showFavorites(null)
    await vi.waitFor(() => expect(client.calls).toHaveLength(3))

    expect(client.calls[2]!.ids).toBeNull()
    expect(client.calls[2]!.query).toBe('')
    expect(session.getState().ids).toBeNull()
  })

  it('setQuery leaves favorites mode (typing always drops the ids filter)', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.showFavorites(['1', '2'])
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))
    session.setQuery('yerba')
    expect(session.getState().ids).toBeNull()

    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    const lastCall = client.calls[client.calls.length - 1]!
    expect(lastCall.query).toBe('yerba')
    expect(lastCall.ids).toBeNull()
  })

  it('setFilters and setSort keep the ids filter (filtering favorites is legitimate)', async () => {
    vi.useFakeTimers()
    const { client, session } = setup()
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.showFavorites(['1', '2'])
    await vi.waitFor(() => expect(client.calls).toHaveLength(2))

    session.setFilters({ categoria: 'Bebidas' })
    await vi.waitFor(() => expect(client.calls).toHaveLength(3))
    expect(client.calls[2]).toMatchObject({ categoria: 'Bebidas', ids: ['1', '2'] })

    session.setSort('price-asc')
    await vi.waitFor(() => expect(client.calls).toHaveLength(4))
    expect(client.calls[3]).toMatchObject({ sort: 'price-asc', ids: ['1', '2'] })
  })

  it('calls onQueryCommit once per debounced query, never for filters, sort or paging', async () => {
    vi.useFakeTimers()
    const committed: string[] = []
    const { client, session } = setup({ onQueryCommit: (q) => committed.push(q) })
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))
    // the initial browse is not a user query
    expect(committed).toEqual([])

    session.setQuery('coca')
    session.setQuery('cocacola')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(committed).toEqual(['cocacola'])

    session.setFilters({ categoria: 'Bebidas' })
    session.setSort('price-asc')
    session.loadMore()
    await vi.runAllTimersAsync()
    expect(committed).toEqual(['cocacola'])
  })

  it('does not commit a blank query', async () => {
    vi.useFakeTimers()
    const committed: string[] = []
    const { client, session } = setup({ onQueryCommit: (q) => committed.push(q) })
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    // positive control first: without it this test would pass even with no wiring
    session.setQuery('coca')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(committed).toEqual(['coca'])

    session.setQuery('   ')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(committed).toEqual(['coca'])
  })

  it('does not commit a query that showFavorites cancelled', async () => {
    vi.useFakeTimers()
    const committed: string[] = []
    const { client, session } = setup({ onQueryCommit: (q) => committed.push(q) })
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.setQuery('coca')
    session.showFavorites(['1'])
    vi.advanceTimersByTime(300)
    await vi.runAllTimersAsync()
    expect(committed).toEqual([])

    // positive control: the callback still fires once the pending query is not cancelled
    session.showFavorites(null)
    session.setQuery('yerba')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    expect(committed).toEqual(['yerba'])
  })

  it('a throwing onQueryCommit never breaks the search run', async () => {
    vi.useFakeTimers()
    const committed: string[] = []
    const { client, session } = setup({
      onQueryCommit: (q) => {
        committed.push(q)
        throw new Error('storage exploded')
      },
    })
    await vi.waitFor(() => expect(client.calls).toHaveLength(1))

    session.setQuery('coca')
    vi.advanceTimersByTime(150)
    await vi.runAllTimersAsync()
    // the callback really ran, and its failure stayed contained
    expect(committed).toEqual(['coca'])
    expect(session.getState().error).toBeNull()
    expect(session.getState().loading).toBe(false)
    expect(client.calls.filter((c) => c.query === 'coca')).toHaveLength(1)
  })
})