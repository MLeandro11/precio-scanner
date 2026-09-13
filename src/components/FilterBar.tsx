import { RotateCcw } from 'lucide-react'
import { formatPrice } from './ProductCard'
import Button from './ui/Button'
import Input from './ui/Input'
import type { Facets } from '../lib/types'

export interface Filters {
  categoria: string
  priceMin: number | null
  priceMax: number | null
}

/**
 * Filter content (design-system §7): category chips + price range + clear + count.
 * It renders inside the bottom Sheet owned by App; the public prop contract is
 * unchanged so the session wiring stays identical.
 *
 * Both filters apply immediately (session handles the worker run).
 */
export default function FilterBar({
  facets,
  filters,
  onFiltersChange,
  total,
}: {
  facets: Facets
  filters: Filters
  onFiltersChange: (filters: Partial<Filters>) => void
  total: number
}) {
  const { categoria, priceMin, priceMax } = filters

  function toggleCategory(c: string) {
    onFiltersChange({ categoria: categoria === c ? '' : c })
  }

  function commitPrice(next: { priceMin: string | number | null; priceMax: string | number | null }) {
    // commit only complete, sane ranges; empty input clears the bound
    const min = next.priceMin === '' ? null : Number(next.priceMin)
    const max = next.priceMax === '' ? null : Number(next.priceMax)
    onFiltersChange({
      priceMin: min != null && Number.isFinite(min) && min >= 0 ? min : null,
      priceMax: max != null && Number.isFinite(max) && max >= 0 ? max : null,
    })
  }

  const hasActiveFilters = Boolean(categoria) || priceMin != null || priceMax != null

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium text-text-secondary">Categoría</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoría">
          {facets.categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-pressed={categoria === c}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-xs font-medium transition ${
                categoria === c
                  ? 'border-surface-sunken bg-surface-sunken text-surface-raised'
                  : 'border-border bg-surface-raised text-text-primary hover:bg-surface'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-text-secondary">Precio</p>
        <div className="flex items-center gap-2">
          <label htmlFor="price-min" className="sr-only">
            Precio mínimo
          </label>
          <Input
            id="price-min"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={formatPrice(facets.priceBounds.min)}
            value={priceMin ?? ''}
            onChange={(e) => commitPrice({ priceMin: e.target.value, priceMax })}
            className="w-full"
          />
          <span aria-hidden="true" className="text-text-secondary">
            –
          </span>
          <label htmlFor="price-max" className="sr-only">
            Precio máximo
          </label>
          <Input
            id="price-max"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder={formatPrice(facets.priceBounds.max)}
            value={priceMax ?? ''}
            onChange={(e) => commitPrice({ priceMin, priceMax: e.target.value })}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-text-secondary tnum" aria-live="polite">
          {total.toLocaleString('es-AR')} productos
        </p>
        <Button
          variant="ghost"
          onClick={() => onFiltersChange({ categoria: '', priceMin: null, priceMax: null })}
          disabled={!hasActiveFilters}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Limpiar filtros
        </Button>
      </div>
    </div>
  )
}