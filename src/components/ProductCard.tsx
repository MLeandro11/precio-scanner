import { Star } from 'lucide-react'
import HighlightedName from './HighlightedName.jsx'

export function formatPrice(precio) {
  return `$ ${precio.toLocaleString('es-AR')}`
}

/**
 * Product card (design-system §5). Price-first: the name and the price carry
 * the visual weight, everything else is quiet.
 */
export default function ProductCard({ product, isFavorite = false, onToggleFavorite }) {
  return (
    <li className="rounded-md border border-border bg-surface-raised p-4 shadow-sm transition-colors active:bg-surface">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-[15px] font-semibold leading-snug text-text-primary">
          <HighlightedName nombre={product.nombre} ranges={product._matches?.nombre} />
        </p>
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          onClick={() => onToggleFavorite?.(product.id)}
          className={`-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
            isFavorite ? 'text-favorite' : 'text-text-secondary hover:text-favorite'
          }`}
        >
          {/* Filled when active, outline otherwise — state is not color-only
              (fill + aria-pressed + aria-label). */}
          <Star size={20} aria-hidden="true" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">
          {product.categoria || 'Sin categoría'}
          {product.barcode && <span className="ml-2 font-mono">· {product.barcode}</span>}
        </span>
        <span className="tnum text-lg font-bold text-accent">{formatPrice(product.precio)}</span>
      </div>
    </li>
  )
}
