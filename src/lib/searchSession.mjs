/**
 * searchSession — search state machine between the UI and the worker client.
 *
 * Owns the interaction rules (spec FR-2.4/2.5, design §Search pipeline):
 *   - query typing is debounced (150 ms default);
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
export function createSearchSession({ client, debounceMs = 150, limit = 50 }) {
  let state = {
    query: '',
    ids: null, // non-empty array = favorites mode (worker restricts to those ids)
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

  const listeners = new Set()
  let runId = 0
  let timer = null

  function emit() {
    listeners.forEach((l) => l(state))
  }

  function patch(p) {
    state = { ...state, ...p }
    emit()
  }

  async function run({ append = false } = {}) {
    const id = ++runId
    const offset = append ? state.results.length : 0
    patch({ loading: true, error: null })
    try {
      const r = await client.query({
        query: state.query,
        ids: state.ids,
        categoria: state.categoria,
        priceMin: state.priceMin,
        priceMax: state.priceMax,
        sort: state.sort,
        limit,
        offset,
      })
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
      if (/superseded/i.test(err.message)) {
        // client dropped this request for a newer one: keep last good results
        patch({ loading: false })
        return
      }
      patch({ loading: false, error: err })
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => run(), debounceMs)
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
      clearTimeout(timer)
      patch({ ids, query: '', results: [] })
      run()
    },
    loadMore() {
      if (state.hasMore && !state.loading) run({ append: true })
    },
    dispose() {
      clearTimeout(timer)
      listeners.clear()
    },
  }
}
