import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createSearchSession } from '../lib/searchSession'
import type { WorkerClient } from '../lib/workerClient'
import type { Facets } from '../lib/types'
import { useSearch } from '../hooks/useSearch'
import { useFavorites } from '../hooks/useFavorites'
import { useRecents } from '../hooks/useRecents'
import { useList } from '../hooks/useList'
import SearchBar from '../components/SearchBar'
import FilterBar from '../components/FilterBar'
import SortSelect from '../components/SortSelect'
import ProductList from '../components/ProductList'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import Sheet from '../components/ui/Sheet'

/**
 * Search page — the core browse/filter/sort experience, now under /buscar.
 * Accepts an initial query via `?q=` so the Home search bar can deep-link.
 */
export default function SearchPage({
  client,
  facets,
}: {
  client: WorkerClient
  facets: Facets
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { recents, addRecent } = useRecents()
  const session = useMemo(
    () => createSearchSession({ client, onQueryCommit: addRecent }),
    [client, addRecent],
  )
  const search = useSearch(session)
  const favorites = useFavorites()
  const favoriteIds = favorites.favorites
  const { add: addToList, isInList } = useList()

  const initialQuery = searchParams.get('q') ?? ''
  const focusFromHome = searchParams.get('focus') === '1'
  const favFromHome = searchParams.get('fav') === '1'
  // Apply a deep-linked query once on mount (e.g. from the Home search bar).
  useEffect(() => {
    if (!initialQuery) return
    session.setQuery(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Favorites entry from Home: reach the favorites view directly.
  useEffect(() => {
    if (!favFromHome || favorites.favorites.length === 0) return
    session.showFavorites(favorites.favorites)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const inFavorites = Array.isArray(search?.ids) && search.ids.length > 0

  useEffect(() => {
    if (!inFavorites || !search) return
    const shown = search.ids ?? []
    const same =
      shown.length === favoriteIds.length && favoriteIds.every((id) => shown.includes(id))
    if (same) return
    search.showFavorites(favoriteIds.length > 0 ? favoriteIds : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteIds, inFavorites])

  if (!search) return null

  const activeFilterCount =
    (search.categoria ? 1 : 0) + (search.priceMin != null ? 1 : 0) + (search.priceMax != null ? 1 : 0)

  const activeFilters: Array<{ label: string; clear: () => void }> = []
  if (search.categoria) {
    activeFilters.push({
      label: search.categoria,
      clear: () => search.setFilters({ categoria: '' }),
    })
  }
  if (search.priceMin != null) {
    const min = search.priceMin
    activeFilters.push({ label: `Mín $${min}`, clear: () => search.setFilters({ priceMin: null }) })
  }
  if (search.priceMax != null) {
    const max = search.priceMax
    activeFilters.push({ label: `Máx $${max}`, clear: () => search.setFilters({ priceMax: null }) })
  }

  return (
    <>
      <header className="safe-top sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-4">
          <Brand />
          <div className="pb-3 pt-3">
            <SearchBar
                query={search.query}
                onQueryChange={search.setQuery}
                autoFocus={focusFromHome}
          />
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
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              {activeFilters.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={f.clear}
                  aria-label={`Quitar filtro ${f.label}`}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent/10 px-3 text-xs font-medium text-accent transition hover:bg-accent/15"
                >
                  {f.label} <span aria-hidden="true">✕</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => search.setFilters({ categoria: '', priceMin: null, priceMax: null })}
                className="min-h-8 rounded-full px-2 text-xs text-text-secondary underline-offset-2 hover:underline"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 pb-6">
        {search.query.trim() === '' && recents.length > 0 && (
          <div className="pt-3">
            {recents.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-text-secondary">
                  Búsquedas recientes
                </p>
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
            onOpenProduct={(p) => navigate(`/producto/${encodeURIComponent(p.id)}`)}
            isInList={isInList}
            onAddToList={(p) => addToList(p.barcode || p.id, p.nombre)}
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