import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useSearchParams, useNavigationType } from 'react-router-dom'
import { toast } from 'sonner'
import { createSearchSession } from '../lib/searchSession'
import type { WorkerClient } from '../lib/workerClient'
import type { Facets, SortOrder } from '../lib/types'
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

function numParam(v: string | null): number | null {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Search page — the core browse/filter/sort experience, now under /buscar.
 *
 * The browse state (query, category, price bounds, sort) lives in the URL search
 * string, so navigating into a product and back restores the same results — the
 * URL is the source of truth, not component memory.
 */
export default function SearchPage({
  client,
  facets,
}: {
  client: WorkerClient
  facets: Facets
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Seed the search from the URL (covers both the Home deep link and a back
  // navigation returning from a product detail).
  const initialQuery = searchParams.get('q') ?? ''
  const focusFromHome = searchParams.get('focus') === '1'
  const favFromHome = searchParams.get('fav') === '1'
  const initialCat = searchParams.get('cat') ?? ''
  const initialSort = (searchParams.get('sort') ?? 'relevance') as SortOrder
  const initialMin = numParam(searchParams.get('pmin'))
  const initialMax = numParam(searchParams.get('pmax'))

  // Skip the very first URL-sync so a restored (back-nav) query is not clobbered
  // by the mount's empty state before the session has caught up.
  const syncedRef = useRef(false)

  // Apply the URL descriptor once on mount.
  useEffect(() => {
    if (initialQuery) session.setQuery(initialQuery)
    if (initialSort !== 'relevance') session.setSort(initialSort)
    if (initialCat || initialMin != null || initialMax != null) {
      session.setFilters({ categoria: initialCat, priceMin: initialMin, priceMax: initialMax })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect the browse state back into the URL (replace: no extra history entries).
  useEffect(() => {
    if (!search) return
    if (!syncedRef.current) {
      syncedRef.current = true
      return
    }
    const p = new URLSearchParams()
    if (search.query) p.set('q', search.query)
    if (search.categoria) p.set('cat', search.categoria)
    if (search.priceMin != null) p.set('pmin', String(search.priceMin))
    if (search.priceMax != null) p.set('pmax', String(search.priceMax))
    if (search.sort !== 'relevance') p.set('sort', search.sort)
    setSearchParams(p, { replace: true })
  }, [search?.query, search?.categoria, search?.priceMin, search?.priceMax, search?.sort])

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
            onAddToList={(p) => {
              addToList(p.barcode || p.id, p.nombre)
              toast('Agregado a tu lista', { description: p.nombre })
            }}
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