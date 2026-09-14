import { Check, Plus } from 'lucide-react'
import HighlightedName from './HighlightedName'
import ProductImage from './ProductImage'
import type { Producto } from '../lib/types'

export function formatPrice(precio: number): string {
  return `$ ${precio.toLocaleString('es-AR')}`
}

/** A product result may carry Fuse match ranges for name highlighting. */
export type ProductWithMatches = Producto & {
  _matches?: { nombre?: Array<[number, number]> }
}

const CATEGORY_EMOJI: Record<string, string> = {
  'Lacteos y fiambres': '🧀',
  'Limpieza': '🧼',
  'Panaderia': '🍞',
  'PANADERIA': '🍞',
  'REPOSTERIA': '🍰',
  'Bebidas': '🥤',
  'Bebidas con alcohol': '🍷',
  'BEBIDAS C ALCOHOL': '🍷',
  'Almacen': '🍚',
  'DESAYUNO': '☕',
  'VERDURAS': '🥦',
  'CARNICERIA': '🥩',
  'Congelados y frescos': '❄️',
  'HELADOS': '🍦',
  'Golosinas': '🍬',
  'Galletitas y snacks': '🍪',
  'FIDEOS': '🍝',
  'Bazar y varios': '🛒',
  'Perfumeria': '🧴',
  'MAQUILLAJE Y BIJOUTERIE': '💄',
  'Mascotas': '🐾',
  'FERRETERIA': '🔧',
  'HERRAMIENTAS': '🛠️',
  'AUTOMOTOR': '🚗',
  'CIGARRILLOS': '🚬',
  'JUGUETERIA': '🧸',
  'JUEGOS DE MESAS': '🎲',
  'LIBRERIA': '📖',
  'Sin categoría': '🧺',
}

function categoryEmoji(categoria: string): string {
  return CATEGORY_EMOJI[categoria] ?? '🧺'
}

/**
 * Product card (design-system outline). Price-first: image tile, name, category
 * + EAN chip, price, and an "add to list" action. Favorites live on the product
 * detail page, not here.
 */
export default function ProductCard({
  product,
  onOpen,
  inList = false,
  onAddToList,
}: {
  product: ProductWithMatches
  onOpen?: (product: ProductWithMatches) => void
  inList?: boolean
  onAddToList?: (product: ProductWithMatches) => void
}) {
  return (
    <li
      onClick={() => onOpen?.(product)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(product)
              }
            }
          : undefined
      }
      className="flex gap-3 rounded-2xl border border-border bg-surface-raised p-3 transition active:bg-surface"
    >
      {/* image tile — real Precios Claros photo by EAN, emoji as fallback */}
      <ProductImage
        ean={product.barcode}
        alt={product.nombre}
        className="h-14 w-14 shrink-0 rounded-xl bg-surface object-cover"
        fallback={<span className="text-3xl">{categoryEmoji(product.categoria)}</span>}
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-text-primary">
          <HighlightedName nombre={product.nombre} ranges={product._matches?.nombre} />
        </p>

        <p className="truncate text-[11px] text-text-secondary">
          {product.categoria || 'Sin categoría'}
        </p>

        {product.barcode ? (
          <span className="mt-1 inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium text-accent">
            EAN {product.barcode}
          </span>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="tnum text-lg font-bold text-text-primary">
            {formatPrice(product.precio)}
          </span>
          {onAddToList ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onAddToList(product)
              }}
              aria-label={
                inList ? `En tu lista: ${product.nombre}` : `Agregar a la lista: ${product.nombre}`
              }
              aria-pressed={inList}
              title={inList ? 'En tu lista' : 'Agregar a la lista'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${
                inList
                  ? 'border-accent bg-accent text-accent-contrast'
                  : 'border-accent text-accent hover:bg-accent/10'
              }`}
            >
              {inList ? (
                <Check size={16} strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}