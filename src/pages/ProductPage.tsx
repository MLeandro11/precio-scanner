import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, History, Plus, Star } from 'lucide-react'
import Brand from '../components/Brand'
import ProductImage from '../components/ProductImage'
import { formatPrice } from '../components/ProductCard'
import Button from '../components/ui/Button'
import { useCatalog } from '../App'
import { useList } from '../hooks/useList'
import { useFavorites } from '../hooks/useFavorites'
import { normalizeEan } from '../lib/lupa/list'
import type { WorkerClient } from '../lib/workerClient'
import type { Producto } from '../lib/types'

async function resolveParam(client: WorkerClient, param: string): Promise<Producto | undefined> {
  const digits = normalizeEan(param).replace(/\D/g, '')
  if (digits.length >= 6) {
    const r = await client.query({ query: digits, limit: 30 })
    const found = r.results.find(
      (p) => normalizeEan(p.barcode).replace(/\D/g, '') === digits,
    )
    if (found) return found
  }
  // fallback: the param is a catalog id (products without barcode)
  const byId = await client.query({ query: '', ids: [param], limit: 5 })
  return byId.results[0]
}

/**
 * Detalle de producto (ruta /producto/:ean). Resuelve el producto por EAN o id
 * desde el catálogo (hoy una sola tienda), muestra su código y permite
 * agregarlo a la lista. La comparación multi-almacén está modelada, sin datos.
 */
export default function ProductPage() {
  const { ean } = useParams<{ ean: string }>()
  const navigate = useNavigate()
  const { client } = useCatalog()
  const { items, add, setCantidad, isInList } = useList()
  const favorites = useFavorites()
  const [product, setProduct] = useState<Producto | undefined>()
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!ean) return
    let alive = true
    setProduct(undefined)
    setNotFound(false)
    resolveParam(client, ean).then((p) => {
      if (!alive) return
      if (p) setProduct(p)
      else setNotFound(true)
    })
    return () => {
      alive = false
    }
  }, [client, ean])

  if (notFound) {
    return (
      <main className="safe-top mx-auto w-full max-w-lg px-4">
        <Brand />
        <div className="mt-12 rounded-2xl border border-border bg-surface-raised px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Producto no encontrado</h2>
          <p className="mt-2 text-sm text-text-secondary">
            No hay ningún producto con ese código en el catálogo actual.
          </p>
          <Button variant="secondary" className="mt-5" onClick={() => navigate('/buscar')}>
            Buscar de nuevo
          </Button>
        </div>
      </main>
    )
  }

  if (!product) {
    return (
      <main className="safe-top mx-auto w-full max-w-lg px-4">
        <Brand />
        <div className="mt-4 h-64 animate-pulse rounded-2xl border border-border bg-surface-raised" />
      </main>
    )
  }

  const inList = isInList(product.barcode || product.id)
  const item = items.find((i) => i.ean === normalizeEan(product.barcode || product.id))

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-6">
      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Volver"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-raised text-text-primary transition hover:bg-surface"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={favorites.isFavorite(product.id)}
            aria-label={favorites.isFavorite(product.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            onClick={() => favorites.toggleFavorite(product.id)}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
              favorites.isFavorite(product.id)
                ? 'border-favorite/40 bg-favorite/10 text-favorite'
                : 'border-border bg-surface-raised text-text-secondary hover:text-favorite'
            }`}
          >
            <Star size={18} aria-hidden="true" fill={favorites.isFavorite(product.id) ? 'currentColor' : 'none'} />
          </button>
          <Link
            to={`/historial/${encodeURIComponent(normalizeEan(product.barcode))}`}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-4 py-2 text-xs font-medium text-text-primary transition hover:bg-surface"
          >
            <History size={15} aria-hidden="true" /> Historial
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <ProductImage
          ean={product.barcode}
          alt={product.nombre}
          className="h-40 w-full rounded-2xl bg-surface object-cover"
          fallback={
            <span className="text-6xl" aria-hidden="true">
              🧺
            </span>
          }
        />
        <div>
          <h2 className="text-lg font-semibold leading-snug text-text-primary">{product.nombre}</h2>
          <p className="mt-1 text-xs text-text-secondary">
            {product.categoria || 'Sin categoría'}
          </p>
          {product.barcode ? (
            <p className="mt-2 inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs font-medium text-accent">
              EAN {product.barcode}
            </p>
          ) : null}
        </div>

        {/* price — single store today; multi-store comparison lands with data */}
        <div className="rounded-2xl border border-border bg-surface-raised p-4">
          <p className="text-xs text-text-secondary">Precio hoy</p>
          <p className="tnum mt-1 text-2xl font-extrabold text-text-primary">
            {formatPrice(product.precio)}
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            Comparación entre almacenes y historial están modelados; llegan cuando
            haya datos de más de una tienda.
          </p>
        </div>
      </div>

      {/* Add to list */}
      <div className="fixed inset-x-0 bottom-24 z-20 mx-auto w-full max-w-lg px-4">
        {inList && item ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-raised p-2 shadow-lg">
            <Button
              variant="secondary"
              size="icon"
              className="shrink-0"
              onClick={() => setCantidad(item.ean, item.cantidad - 1)}
              aria-label="Restar uno"
            >
              −
            </Button>
            <span className="tnum flex-1 text-center text-sm font-semibold text-text-primary">
              {item.cantidad} en tu lista <Check size={14} className="inline text-accent" />
            </span>
            <Button
              variant="secondary"
              size="icon"
              className="shrink-0"
              onClick={() => setCantidad(item.ean, item.cantidad + 1)}
              aria-label="Sumar uno"
            >
              +
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            className="w-full shadow-lg"
            onClick={() => add(product.barcode || product.id, product.nombre)}
          >
            <Plus size={18} aria-hidden="true" /> Agregar a mi lista
          </Button>
        )}
      </div>
    </main>
  )
}