import { useEffect, useState } from 'react'

/**
 * Thin React adapter over a createSearchSession() instance.
 * The session owns all logic (debounce, superseding, paging); this hook only
 * mirrors its state into React.
 */
export function useSearch(session) {
  const [state, setState] = useState(() => session?.getState() ?? null)

  useEffect(() => {
    if (!session) return
    setState(session.getState())
    const unsubscribe = session.subscribe(setState)
    return () => {
      unsubscribe()
    }
  }, [session])

  useEffect(() => () => session?.dispose(), [session])

  if (!session || !state) return null

  return {
    ...state,
    setQuery: (q) => session.setQuery(q),
    setFilters: (f) => session.setFilters(f),
    setSort: (s) => session.setSort(s),
    loadMore: () => session.loadMore(),
  }
}
