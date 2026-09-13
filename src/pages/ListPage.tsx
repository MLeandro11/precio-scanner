import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Barcode as BarcodeIcon, Minus, Plus } from 'lucide-react'
import Brand from '../components/Brand'
import Barcode from '../components/Barcode'
import { formatPrice } from '../components/ProductCard'
import Button from '../components/ui/Button'
import { useCatalog } from '../App'
import { useList } from '../hooks/useList'
import { useResolveEans } from '../hooks/useResolveEans'

type ListView = 'lista' | 'codigos'

/**
 * Mi lista de compras. Cada ítem está identificado por su EAN; hoy hay una sola
 * tienda, así que "mejor precio" es el precio del catálogo. Un selector muestra
 * la imagen literal del código de barras de cada producto (para escanear en el
 * almacén). Los avisos y la comparación multi-almacén quedan modelados.
 */
export default function ListPage() {
  const [view, setView] = useState<ListView>('lista')
  const { client } = useCatalog()
  const { items, remove, setCantidad } = useList()

  const eans = useMemo(() => items.map((i) => i.ean), [items])
  const products = useResolveEans(client, eans)

  const pricesKnown = items.reduce((acc, item, idx) => acc + (products[idx] ? 1 : 0), 0)
  const total = items.reduce((acc, item, idx) => {
    const p = products[idx]
    return acc + (p ? p.precio * item.cantidad : 0)
  }, 0)

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <div className="flex items-center justify-between">
        <Brand />
        <span className="text-xs font-medium text-text-secondary">
          {items.length} producto{items.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* View selector: lista | códigos de barras */}
      <div
        className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
        role="group"
        aria-label="Vista de la lista"
      >
        <button
          type="button"
          onClick={() => setView('lista')}
          aria-pressed={view === 'lista'}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
            view === 'lista' ? 'bg-surface-raised shadow-sm text-text-primary' : 'text-text-muted'
          }`}
        >
          Lista
        </button>
        <button
          type="button"
          onClick={() => setView('codigos')}
          aria-pressed={view === 'codigos'}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
            view === 'codigos' ? 'bg-surface-raised shadow-sm text-accent' : 'text-text-muted'
          }`}
        >
          <BarcodeIcon size={14} strokeWidth={1.8} aria-hidden="true" /> Códigos de barras
        </button>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-surface-raised px-6 py-12 text-center">
          <p className="text-sm font-semibold text-text-primary">Tu lista está vacía</p>
          <p className="mt-1 text-sm text-text-secondary">
            Buscá un producto o escaneá su código para agregarlo.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/buscar">
              <Button variant="secondary">Buscar</Button>
            </Link>
            <Link to="/escanear">
              <Button variant="primary">Escanear</Button>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item, idx) => {
            const p = products[idx]
            const name = p?.nombre ?? item.nombre ?? item.ean
            const price = p?.precio
            return (
              <li
                key={item.ean}
                className="rounded-2xl border border-border bg-surface-raised p-3"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => remove(item.ean)}
                    aria-label={`Quitar ${name} de la lista`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition hover:text-danger"
                  >
                    <Minus size={16} aria-hidden="true" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
                    <p className="font-mono text-[11px] text-text-muted">EAN {item.ean}</p>
                    {item.alerta ? (
                      <p className="text-[11px] font-medium text-accent">🔔 alerta de precio</p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {price != null ? (
                      <span className="tnum text-sm font-bold text-text-primary">
                        {formatPrice(price * item.cantidad)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-text-muted">sin precio</span>
                    )}
                    <div className="flex items-center gap-2 rounded-full border border-border px-1">
                      <button
                        type="button"
                        onClick={() => setCantidad(item.ean, item.cantidad - 1)}
                        aria-label="Restar uno"
                        className="flex h-6 w-6 items-center justify-center text-text-secondary"
                      >
                        −
                      </button>
                      <span className="tnum w-4 text-center text-xs font-semibold text-text-primary">
                        {item.cantidad}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCantidad(item.ean, item.cantidad + 1)}
                        aria-label="Sumar uno"
                        className="flex h-6 w-6 items-center justify-center text-accent"
                      >
                        <Plus size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* literal barcode image, per the list view selector */}
                {view === 'codigos' ? (
                  <div className="mt-3 flex items-center justify-center rounded-lg border border-border bg-surface px-2 py-2">
                    <Barcode value={item.ean} width={200} height={46} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {items.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">
              {pricesKnown}/{items.length} con precio
            </span>
            <span className="tnum font-extrabold text-text-primary">
              Total ${total.toLocaleString('es-AR')}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Comparación entre almacenes y avisos en futura versión (modelados).
          </p>
        </div>
      ) : null}
    </main>
  )
}