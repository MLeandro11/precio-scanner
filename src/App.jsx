import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ScanBarcode, SlidersHorizontal, Star } from 'lucide-react'
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
import Button from './components/ui/Button.jsx'
import Sheet from './components/ui/Sheet.jsx'
import SkeletonList from './components/ui/Skeleton.jsx'

function AppIdentity({ titleId }) {
  return (
    <div className="flex items-center gap-2 pt-4">
      <ScanBarcode size={22} aria-hidden="true" className="text-accent" />
      <h1 id={titleId} className="text-xl font-bold leading-none text-text-primary">
        precio-scanner
      </h1>
    </div>
  )
}

function CatalogView({ client, facets }) {
  const [filtersOpen, setFiltersOpen] = useState(false)
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

  const activeFilterCount =
    (search.categoria ? 1 : 0) + (search.priceMin != null ? 1 : 0) + (search.priceMax != null ? 1 : 0)

  return (
    <>
      <header className="safe-top sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-4">
          <AppIdentity />
          <div className="pb-3 pt-3">
            <SearchBar query={search.query} onQueryChange={search.setQuery} />
          </div>
          <div className="flex items-center justify-between gap-2 pb-3">
            <Button
              variant="secondary"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              className="rounded-full"
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-contrast">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <SortSelect sort={search.sort} onSortChange={search.setSort} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 pb-6">
        {search.query.trim() === '' &&
          (favorites.favorites.length > 0 || recents.length > 0) && (
            <div className="pt-3">
              {favorites.favorites.length > 0 && (
                <button
                  type="button"
                  onClick={() => search.showFavorites(favorites.favorites)}
                  className="mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-favorite/40 bg-favorite/10 px-4 text-xs font-medium text-text-primary transition hover:bg-favorite/15"
                >
                  <Star size={16} aria-hidden="true" fill="currentColor" className="text-favorite" />
                  Favoritos ({favorites.favorites.length})
                </button>
              )}
              {recents.length > 0 && (
                <>
                  <p className="mb-1.5 text-xs font-medium text-text-secondary">Búsquedas recientes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recents.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => search.setQuery(r)}
                        className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface-raised px-4 text-xs text-text-primary transition hover:bg-surface"
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
          <div className="pt-3">
            <Button variant="secondary" onClick={() => search.showFavorites(null)}>
              <ArrowLeft size={16} aria-hidden="true" />
              Volver
            </Button>
          </div>
        )}

        <div className="pt-3">
          <ProductList
            search={search}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={favorites.toggleFavorite}
          />
        </div>
      </main>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtros">
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
      </Sheet>
    </>
  )
}

function BootScreen() {
  return (
    <div className="min-h-dvh bg-surface">
      <div className="safe-top mx-auto w-full max-w-lg px-4">
        <AppIdentity />
        <div className="pb-3 pt-3" role="status" aria-live="polite">
          <span className="sr-only">Cargando catálogo…</span>
          <div className="skeleton h-11 w-full rounded-full" />
        </div>
        <SkeletonList />
      </div>
    </div>
  )
}

function ErrorScreen() {
  return (
    <div className="safe-top flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="text-center">
        <AppIdentity />
        <p className="mt-3 text-sm text-danger">No se pudo cargar el catálogo.</p>
        <Button
          variant="primary"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Reintentar
        </Button>
      </div>
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

  if (phase === 'loading') return <BootScreen />
  if (phase === 'error') return <ErrorScreen />

  return (
    <div className="min-h-dvh bg-surface">
      <CatalogView client={boot.client} facets={boot.facets} />
    </div>
  )
}
