/**
 * searchSession — search state machine between the UI and the worker client.
 *
 * Owns the interaction rules (spec FR-2.4/2.5, design §Search pipeline):
 *   - query typing is debounced (150 ms default);
 *   - a committed query (debounced and non-blank) is reported once through the
 *     optional `onQueryCommit` callback so the caller can persist it as a recent
 *     search; the initial browse, filters, sort and paging are not commits, and a
 *     throwing callback can never break a run;
 *   - filters and sort apply immediately (cheap worker runs);
 *   - favorites mode: `showFavorites(ids)` swaps the whole result set for the
 *     stored ids and runs immediately; typing or an explicit `null` leaves it;
 *   - one run in flight: a new run supersedes the previous one; stale worker
 *     rejections ('superseded') are swallowed, real errors surface as
 *     state.error;
 *   - paging: `loadMore` appends the next page; any new query/filter resets
 *     to page 0.
 *
 * Framework-agnostic (no React) so it unit-tests in plain Node; useSearch is
 * the thin React adapter.
 */
import type { Producto, QueryParams, QueryResult, SortOrder } from './types'

/** Sólo la parte de consulta del cliente que la sesión usa (inyectable en tests). */
export interface QueryClient {
  query(params: QueryParams): Promise<QueryResult>
}

export interface SearchState {
  query: string
  /** Non-empty array = favorites mode (worker restricts to those ids). */
  ids: string[] | null
  categoria: string
  priceMin: number | null
  priceMax: number | null
  sort: SortOrder
  results: Producto[]
  total: number
  loading: boolean
  error: unknown
  hasMore: boolean
}

export type SearchFilters = Pick<SearchState, 'categoria' | 'priceMin' | 'priceMax'>

export interface SearchSession {
  subscribe: (listener: (state: SearchState) => void) => () => void
  getState: () => SearchState
  setQuery: (query: string) => void
  setFilters: (filters?: Partial<SearchFilters>) => void
  setSort: (sort: SortOrder) => void
  showFavorites: (ids: string[] | null) => void
  loadMore: () => void
  dispose: () => void
}

interface SessionDeps {
  client: QueryClient
  debounceMs?: number
  limit?: number
  onQueryCommit?: (query: string) => void
}

export function createSearchSession({
  client,
  debounceMs = 150,
  limit = 50,
  onQueryCommit,
}: SessionDeps): SearchSession {
  let state: SearchState = {
    query: '',
    ids: null,
    categoria: '',
    priceMin: null,
    priceMax: null,
    sort: 'relevance',
    results: [],
    total: 0,
    loading: true,
    error: null,
    hasMore: false,
  }

  const listeners = new Set<(s: SearchState) => void>()
  let runId = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function emit() {
    listeners.forEach((l) => l(state))
  }

  function patch(p: Partial<SearchState>) {
    state = { ...state, ...p }
    emit()
  }

  async function run({ append = false }: { append?: boolean } = {}) {
    const id = ++runId
    const offset = append ? state.results.length : 0
    patch({ loading: true, error: null })
    try {
      const params: QueryParams = {
        query: state.query,
        ids: state.ids,
        categoria: state.categoria,
        priceMin: state.priceMin,
        priceMax: state.priceMax,
        sort: state.sort,
        limit,
        offset,
      }
      const r = await client.query(params)
      if (id !== runId) return // a newer run already superseded this one
      const shown = offset + r.results.length
      patch({
        results: append ? [...state.results, ...r.results] : r.results,
        total: r.total,
        loading: false,
        hasMore: shown < r.total,
      })
    } catch (err) {
      if (id !== runId) return // a newer run already superseded this one
      if (err instanceof Error && /superseded/i.test(err.message)) {
        // client dropped this request for a newer one: keep last good results
        patch({ loading: false })
        return
      }
      patch({ loading: false, error: err })
    }
  }

  /**
   * Reports a committed query, best-effort. Persisting a recent search is a side
   * effect: if storage is unavailable or full it must not surface as a search
   * error, so the callback is deliberately isolated here.
   */
  function commitQuery() {
    const q = state.query.trim()
    if (!q || !onQueryCommit) return
    try {
      onQueryCommit(q)
    } catch {
      // ignore: a failed recent-search write is not worth breaking search for
    }
  }

  function schedule() {
    clearTimeout(timer ?? undefined)
    timer = setTimeout(() => {
      commitQuery()
      run()
    }, debounceMs)
  }

  // initial browse: the worker answers the empty query with the first page
  run()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState() {
      return state
    },
    setQuery(query) {
      // typing always leaves favorites mode
      patch({ query, ids: null })
      schedule()
    },
    setFilters(filters = {}) {
      patch(filters)
      run()
    },
    setSort(sort) {
      patch({ sort })
      run()
    },
    showFavorites(ids) {
      // A chip click is deliberate, so drop any pending debounced query and run
      // now. `ids: null` leaves favorites mode and restores the normal browse.
      clearTimeout(timer ?? undefined)
      patch({ ids, query: '', results: [] })
      run()
    },
    loadMore() {
      if (state.hasMore && !state.loading) run({ append: true })
    },
    dispose() {
      clearTimeout(timer ?? undefined)
      listeners.clear()
    },
  }
}