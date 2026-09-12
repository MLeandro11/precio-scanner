import { formatPrice } from './ProductCard.jsx'

/**
 * Category chips + price range inputs, populated from build-time facets
 * (spec FR-3.2: never derived by scanning the catalog in the main thread).
 * Both filters apply immediately (session handles the worker run).
 */
export default function FilterBar({ facets, filters, onFiltersChange, total }) {
  const { categoria, priceMin, priceMax } = filters

  function toggleCategory(c) {
    onFiltersChange({ categoria: categoria === c ? '' : c })
  }

  function commitPrice(next) {
    // commit only complete, sane ranges; empty input clears the bound
    const min = next.priceMin === '' ? null : Number(next.priceMin)
    const max = next.priceMax === '' ? null : Number(next.priceMax)
    onFiltersChange({
      priceMin: min != null && Number.isFinite(min) && min >= 0 ? min : null,
      priceMax: max != null && Number.isFinite(max) && max >= 0 ? max : null,
    })
  }

  return (
    <div className="mb-3 space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoría">
        {facets.categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => toggleCategory(c)}
            aria-pressed={categoria === c}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              categoria === c
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-600">
        <label htmlFor="price-min">Precio</label>
        <input
          id="price-min"
          type="number"
          inputMode="numeric"
          min="0"
          placeholder={formatPrice(facets.priceBounds.min)}
          value={priceMin ?? ''}
          onChange={(e) => commitPrice({ priceMin: e.target.value, priceMax })}
          className="w-24 rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-slate-500"
        />
        <span>–</span>
        <input
          id="price-max"
          type="number"
          inputMode="numeric"
          min="0"
          placeholder={formatPrice(facets.priceBounds.max)}
          value={priceMax ?? ''}
          onChange={(e) => commitPrice({ priceMin, priceMax: e.target.value })}
          className="w-24 rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:border-slate-500"
        />
        {(categoria || priceMin != null || priceMax != null) && (
          <button
            type="button"
            onClick={() => onFiltersChange({ categoria: '', priceMin: null, priceMax: null })}
            className="ml-auto text-slate-500 underline hover:text-slate-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500" aria-live="polite">
        {total.toLocaleString('es-AR')} productos
      </p>
    </div>
  )
}
