import ProductCard from './ProductCard.jsx'

export default function ProductList({ search }) {
  const { results, total, loading, error, hasMore, query, categoria, priceMin, priceMax } = search

  if (error) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Ocurrió un error al buscar. Reintentá.
      </p>
    )
  }

  const hasQuery = query.trim() !== ''
  const hasFilters = Boolean(categoria) || priceMin != null || priceMax != null

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500" aria-live="polite">
        {loading && !hasQuery
          ? 'Buscando…'
          : total === 0
            ? ''
            : `Mostrando ${results.length} de ${total.toLocaleString('es-AR')} productos`}
      </p>

      {total === 0 && (hasQuery || hasFilters) ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center">
          <p className="text-4xl" aria-hidden="true">
            🔍
          </p>
          <p className="mt-3 font-medium text-slate-800">Sin resultados</p>
          <p className="mt-1 text-sm text-slate-500">
            {hasQuery ? (
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
              <button
                type="button"
                onClick={() => search.setQuery('')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Limpiar búsqueda
              </button>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => search.setFilters({})}
                className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Quitar filtros
              </button>
            )}
          </div>
        </div>
      ) : null}

      <ul className="space-y-2">
        {results.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={search.loadMore}
          disabled={loading}
          className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : `Ver más (${(total - results.length).toLocaleString('es-AR')} restantes)`}
        </button>
      )}
    </div>
  )
}
