import HighlightedName from './HighlightedName.jsx'

export function formatPrice(precio) {
  return `$ ${precio.toLocaleString('es-AR')}`
}

export default function ProductCard({ product }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-slate-900">
        <HighlightedName nombre={product.nombre} ranges={product._matches?.nombre} />
      </p>
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
