import { useEffect, useMemo, useState } from 'react'
import { loadCatalog } from './lib/catalogLoader.mjs'
import { createWorkerClient } from './lib/workerClient.mjs'
import { createSearchSession } from './lib/searchSession.mjs'
import { useSearch } from './hooks/useSearch.js'
import { useFavorites } from './hooks/useFavorites.js'
import { useRecents } from './hooks/useRecents.js'
import SearchBar from './components/SearchBar.jsx'
import FilterBar from './components/FilterBar.jsx'
import SortSelect from './components/SortSelect.jsx'
import ProductList from './components/ProductList.jsx'

function CatalogView({ client, facets }) {
  const { recents, addRecent } = useRecents()
  // `addRecent` is stable, so this session is created once per client and still
  // sees the latest recents list when it commits a query.
  const session = useMemo(
    () => createSearchSession({ client, onQueryCommit: addRecent }),
    [client, addRecent],
  )
  const search = useSearch(session)
  const favorites = useFavorites()
  const favoriteIds = favorites.favorites

  // non-empty id list = the session is showing favorites, not browsing
  const inFavorites = Array.isArray(search?.ids) && search.ids.length > 0

  // Favorites mode renders a snapshot of ids, so it goes stale the instant the user
  // unfavorites a row from inside the list. Re-run with the current ids; if the list
  // empties, leave favorites mode rather than leave a stale page on screen.
  useEffect(() => {
    if (!inFavorites) return
    const shown = search.ids ?? []
    const same =
      shown.length === favoriteIds.length && favoriteIds.every((id) => shown.includes(id))
    if (same) return
    search.showFavorites(favoriteIds.length > 0 ? favoriteIds : null)
    // `search` is deliberately not a dependency: useSearch returns a new object on
    // every render, so depending on it would re-run this effect forever.
  }, [favoriteIds, inFavorites])

  if (!search) return null

  return (
    <div className="mx-auto max-w-2xl px-4 pb-10">
      <h1 className="pt-4 text-xl font-bold text-slate-900">precio-scanner</h1>
      <SearchBar query={search.query} onQueryChange={search.setQuery} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <SortSelect sort={search.sort} onSortChange={search.setSort} />
      </div>

      <FilterBar
        facets={facets}
        filters={{
          categoria: search.categoria,
          priceMin: search.priceMin,
          priceMax: search.priceMax,
        }}
        onFiltersChange={search.setFilters}
        total={search.total}
      />

      {search.query.trim() === '' &&
        (favorites.favorites.length > 0 || recents.length > 0) && (
          <div className="mb-3">
            {favorites.favorites.length > 0 && (
              <button
                type="button"
                onClick={() => search.showFavorites(favorites.favorites)}
                className="mb-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                ★ Favoritos ({favorites.favorites.length})
              </button>
            )}
            {recents.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Búsquedas recientes</p>
                <div className="flex flex-wrap gap-1.5">
                  {recents.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => search.setQuery(r)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      {inFavorites && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => search.showFavorites(null)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Volver
          </button>
        </div>
      )}

      <ProductList
        search={search}
        isFavorite={favorites.isFavorite}
        onToggleFavorite={favorites.toggleFavorite}
      />
    </div>
  )
}

/**
 * Boot path (design §Large-catalog client handling):
 *   loadCatalog (cache/network) → worker init → ready.
 * The main thread touches the product array only to hand it to the worker at
 * boot; it never keeps a copy (the worker owns the catalog).
 */
export default function App() {
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [boot, setBoot] = useState(null) // { client, facets }

  useEffect(() => {
    let cancelled = false

    async function bootCatalog() {
      try {
        const data = await loadCatalog()
        const client = createWorkerClient()
        await client.init(data)
        if (cancelled) return
        // `data` (incl. the big products array) goes out of scope here —
        // only the small facets survive on the main thread.
        setBoot({ client, facets: data.facets })
        setPhase('ready')
      } catch (err) {
        console.error('catalog boot failed', err)
        if (!cancelled) setPhase('error')
      }
    }

    bootCatalog()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center" role="status" aria-live="polite">
          <h1 className="text-2xl font-semibold text-slate-800">precio-scanner</h1>
          <p className="mt-3 text-slate-500 animate-pulse">Cargando catálogo…</p>
          <div className="mt-4 h-1 w-48 mx-auto overflow-hidden rounded bg-slate-200">
            <div className="h-full w-1/2 bg-slate-400 animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-slate-800">precio-scanner</h1>
          <p className="mt-3 text-red-600">No se pudo cargar el catálogo.</p>
          <button
            className="mt-4 rounded bg-slate-800 px-4 py-2 text-white hover:bg-slate-700"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <CatalogView client={boot.client} facets={boot.facets} />
    </div>
  )
}
