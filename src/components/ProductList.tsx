import { PackageSearch, SearchX } from 'lucide-react'
import ProductCard from './ProductCard.jsx'
import Button from './ui/Button.jsx'
import SkeletonList from './ui/Skeleton.jsx'

export default function ProductList({ search, isFavorite, onToggleFavorite }) {
  const { results, total, loading, error, hasMore, query, categoria, priceMin, priceMax } = search

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
      >
        Ocurrió un error al buscar. Reintentá.
      </p>
    )
  }

  const hasQuery = query.trim() !== ''
  const hasFilters = Boolean(categoria) || priceMin != null || priceMax != null
  const inFavorites = Array.isArray(search.ids) && search.ids.length > 0

  // First load has nothing to show yet -> skeleton rows (§5).
  const showSkeleton = loading && results.length === 0
  const showEmpty = !loading && total === 0 && (hasQuery || hasFilters || inFavorites)
  const EmptyIcon = hasQuery ? SearchX : PackageSearch

  return (
    <div>
      <p className="tnum mb-3 text-xs text-text-secondary" aria-live="polite">
        {loading && !hasQuery
          ? 'Buscando…'
          : total === 0
            ? ''
            : `Mostrando ${results.length} de ${total.toLocaleString('es-AR')} productos`}
      </p>

      {showSkeleton ? <SkeletonList /> : null}

      {showEmpty ? (
        <div className="rounded-md border border-border bg-surface-raised px-6 py-10 text-center">
          <EmptyIcon size={40} aria-hidden="true" className="mx-auto text-text-muted" />
          <p className="mt-3 text-[15px] font-semibold text-text-primary">Sin resultados</p>
          <p className="mt-1 text-sm text-text-secondary">
            {inFavorites ? (
              <>Ninguno de tus favoritos está en el catálogo actual.</>
            ) : hasQuery ? (
              <>
                Nada coincide con “{query.trim()}”
                {categoria ? <> en {categoria}</> : null}.
              </>
            ) : (
              <>Ningún producto cumple con los filtros aplicados.</>
            )}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {hasQuery && (
              <Button variant="secondary" onClick={() => search.setQuery('')}>
                Limpiar búsqueda
              </Button>
            )}
            {hasFilters && (
              <Button variant="secondary" onClick={() => search.setFilters({})}>
                Quitar filtros
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {results.length > 0 ? (
        <ul className="space-y-2">
          {results.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              isFavorite={isFavorite?.(p.id) ?? false}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </ul>
      ) : null}

      {hasMore ? (
        <div className="safe-bottom mt-4">
          <Button variant="secondary" onClick={search.loadMore} disabled={loading} className="w-full">
            {loading
              ? 'Cargando…'
              : `Ver más (${(total - results.length).toLocaleString('es-AR')} restantes)`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
