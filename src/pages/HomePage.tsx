import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ChevronRight, ScanBarcode, Search, Star } from 'lucide-react'
import Brand from '../components/Brand'
import Input from '../components/ui/Input'
import { useCatalog } from '../App'
import { useList } from '../hooks/useList'
import { useFavorites } from '../hooks/useFavorites'
import { useResolveEans } from '../hooks/useResolveEans'

/**
 * Home page — search-first entry to Lupa (mirrors the product mockup):
 * hero de búsqueda que deep-linkea a /buscar, resumen de Mi lista con
 * productos resueltos por EAN y acceso al escáner.
 */
export default function HomePage() {
  const navigate = useNavigate()
  const { client } = useCatalog()
  const { items } = useList()
  const { favorites } = useFavorites()

  const eans = useMemo(() => items.map((i) => i.ean), [items])
  const products = useResolveEans(client, eans)

  const total = useMemo(
    () =>
      items.reduce((acc, item, idx) => {
        const p = products[idx]
        return acc + (p ? p.precio * item.cantidad : 0)
      }, 0),
    [items, products],
  )
  const pricesKnown = items.reduce(
    (acc, item, idx) => acc + (products[idx] ? 1 : 0),
    0,
  )

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4">
      <div className="flex items-center justify-between">
        <Brand />
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-raised text-sm font-semibold text-text-secondary">
          LM
        </div>
      </div>

      {/* Search gateway: tapping the input hops to the live search screen. */}
      <div className="pt-5">
        <div className="relative">
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <Input
            type="search"
            readOnly
            placeholder="Buscar un producto del almacén…"
            aria-label="Buscar un producto del almacén"
            className="cursor-pointer rounded-full pl-11 pr-4 [&:focus]:border-accent"
            onClick={() => navigate('/buscar?focus=1')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate('/buscar?focus=1')
              }
            }}
          />
        </div>
      </div>

      <p className="pt-4 text-center text-sm text-text-secondary">
        Buscá por nombre o por código de barras (EAN).
      </p>

      {/* Mi lista summary */}
      <section className="pt-6">
        <button
          type="button"
          onClick={() => navigate('/lista')}
          className="w-full rounded-2xl border border-border bg-surface-raised p-4 text-left transition hover:bg-surface"
        >
          <span className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">
              Mi lista {items.length > 0 ? `· ${items.length} producto${items.length === 1 ? '' : 's'}` : ''}
            </span>
            <span className="flex items-center text-xs font-medium text-accent">
              Ver precios <ChevronRight size={14} aria-hidden="true" />
            </span>
          </span>

          {items.length === 0 ? (
            <span className="mt-3 block text-xs text-text-secondary">
              Todavía no agregaste nada. Buscá o escaneá un producto para armar tu lista.
            </span>
          ) : (
            <>
              <span className="mt-3 flex flex-wrap gap-2">
                {items.slice(0, 6).map((item, idx) => {
                  const p = products[idx]
                  return (
                    <span
                      key={item.ean}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-primary"
                    >
                      {p ? p.nombre : (item.nombre ?? item.ean)}
                      {item.cantidad > 1 ? <b className="text-accent">×{item.cantidad}</b> : null}
                    </span>
                  )
                })}
              </span>
              <span className="tnum mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className="text-text-secondary">
                  {pricesKnown}/{items.length} con precio
                </span>
                <span className="font-semibold text-text-primary">
                  Total ${total.toLocaleString('es-AR')}
                </span>
              </span>
            </>
          )}
        </button>
      </section>

      {/* Quick entries */}
      <div className="mt-4 flex flex-col gap-3">
        {favorites.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/buscar?fav=1')}
            className="flex min-h-14 items-center gap-4 rounded-2xl border border-border bg-surface-raised px-5 text-left transition hover:bg-surface"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-favorite">
              <Star size={20} strokeWidth={1.8} aria-hidden="true" fill="currentColor" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-text-primary">Favoritos</span>
              <span className="block text-xs text-text-secondary">
                {favorites.length} producto{favorites.length === 1 ? '' : 's'} guardados
              </span>
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/escanear')}
          className="flex min-h-14 items-center gap-4 rounded-2xl border border-accent bg-accent/5 px-5 text-left transition hover:bg-accent/10"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-contrast">
            <ScanBarcode size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-text-primary">
              Escanear código de barras
            </span>
            <span className="block text-xs text-text-secondary">
              Agregá el producto a tu lista al instante
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/alertas')}
          className="flex min-h-14 items-center gap-4 rounded-2xl border border-border bg-surface-raised px-5 text-left transition hover:bg-surface"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-text-secondary">
            <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-text-primary">Alertas de precio</span>
            <span className="block text-xs text-text-secondary">
              Te avisamos cuando un producto baje de precio
            </span>
          </span>
        </button>
      </div>
    </main>
  )
}