import { useEffect, useState } from 'react'
import type { SearchSession, SearchState, SearchFilters } from '../lib/searchSession'
import type { SortOrder } from '../lib/types'

/**
 * Thin React adapter over a createSearchSession() instance.
 * The session owns all logic (debounce, superseding, paging); this hook only
 * mirrors its state into React.
 */
export interface SearchControls {
  setQuery: (q: string) => void
  setFilters: (f: Partial<SearchFilters>) => void
  setSort: (s: SortOrder) => void
  showFavorites: (ids: string[] | null) => void
  loadMore: () => void
}

export function useSearch(
  session: SearchSession | undefined,
): (SearchState & SearchControls) | null | undefined {
  const [state, setState] = useState<SearchState | null>(() => session?.getState() ?? null)

  useEffect(() => {
    if (!session) return
    setState(session.getState())
    const unsubscribe = session.subscribe(setState)
    return () => {
      unsubscribe()
    }
  }, [session])

  useEffect(() => () => session?.dispose(), [session])

  if (!session || !state) return undefined

  return {
    ...state,
    setQuery: (q) => session.setQuery(q),
    setFilters: (f) => session.setFilters(f),
    setSort: (s) => session.setSort(s),
    showFavorites: (ids) => session.showFavorites(ids),
    loadMore: () => session.loadMore(),
  }
}