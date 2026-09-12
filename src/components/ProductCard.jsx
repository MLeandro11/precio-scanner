import HighlightedName from './HighlightedName.jsx'

export function formatPrice(precio) {
  return `$ ${precio.toLocaleString('es-AR')}`
}

export default function ProductCard({ product, isFavorite = false, onToggleFavorite }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm font-medium text-slate-900">
          <HighlightedName nombre={product.nombre} ranges={product._matches?.nombre} />
        </p>
        <button
          type="button"
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          onClick={() => onToggleFavorite?.(product.id)}
          className="shrink-0 rounded px-1 leading-none text-amber-500 hover:bg-slate-100"
        >
          <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {product.categoria || 'Sin categoría'}
          {product.barcode && <span className="ml-2 font-mono">· {product.barcode}</span>}
        </span>
        <span className="text-base font-semibold text-slate-800">
          {formatPrice(product.precio)}
        </span>
      </div>
    </li>
  )
}
