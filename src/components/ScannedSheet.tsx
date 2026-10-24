import { Plus, ScanBarcode, Trash2 } from 'lucide-react'
import Sheet from './ui/Sheet'
import type { ScannedItem } from '../lib/lupa/scanned'

/**
 * Lo escaneado en esta sesión, en el bottom sheet del sistema (`ui/Sheet` es un
 * diálogo real: foco atrapado y devuelto, Escape y backdrop, `70dvh` con scroll).
 *
 * No hay estado propio: el acumulado vive en la pantalla y este componente solo
 * lo dibuja y devuelve intenciones (`onAdd`, `onRemove`, `onOpenProduct`). Eso es
 * lo que permite probarlo sin cámara ni catálogo.
 *
 * Las filas siguen el idiom de la product card (tile 56px, nombre a dos líneas,
 * precio `tabular-nums`, controles de 44px). La fila dice `×N` cuando el mismo
 * EAN se escaneó más de una vez: es información del acto de escanear, no de la
 * lista de compras.
 *
 * Ganchos estables para la aceptación, con la misma convención que `/cambios`:
 *   - `data-scanned-count` en el cuerpo del panel (cuántas filas hay)
 *   - `data-scanned-row="<ean>"` por fila
 *   - `data-scanned-add` / `data-scanned-open` / `data-scanned-remove` por control
 */
export default function ScannedSheet({
  open,
  items,
  onClose,
  onAdd,
  onRemove,
  onOpenProduct,
  cantidadEnLista,
}: {
  open: boolean
  items: ScannedItem[]
  onClose: () => void
  onAdd: (item: ScannedItem) => void
  onRemove: (item: ScannedItem) => void
  onOpenProduct: (ean: string) => void
  /** Unidades de ese EAN en `Mi lista`; 0 cuando no está. */
  cantidadEnLista: (ean: string) => number
}) {
  const total = items.length

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Escaneados"
      closeLabel="Cerrar escaneados"
      description={
        total === 0
          ? 'Acá quedan los productos que encuentra el catálogo mientras escaneás, aunque no los agregues a tu lista.'
          : `${total === 1 ? '1 producto' : `${total} productos`} en esta sesión. La lista se vacía cuando recargás la pantalla.`
      }
    >
      <div data-scanned-count={total}>
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ScanBarcode size={28} className="text-text-muted" aria-hidden="true" />
            <p className="text-sm font-semibold text-text-primary">Todavía no escaneaste nada</p>
            <p className="text-xs text-text-secondary">
              Cada producto que encuentre el catálogo va a aparecer acá.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const enLista = cantidadEnLista(item.ean)
              const addLabel = enLista
                ? `${item.nombre} — sumar otro (${enLista} en tu lista)`
                : `${item.nombre} — agregar a tu lista`
              return (
                <li
                  key={item.ean}
                  data-scanned-row={item.ean}
                  className="rounded-2xl border border-border bg-surface-raised p-3"
                >
                  {/* La geometría es la de la fila de /lista: control de quitar a la
                      izquierda, producto en el medio, precio y cantidad a la derecha.
                      Un contador de ancho variable a la derecha desalinea la fila
                      entera (y `+3` se lee igual que `+12` sólo si no se mueve). */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-scanned-remove={item.ean}
                      aria-label={`Quitar ${item.nombre} de escaneados`}
                      onClick={() => onRemove(item)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary transition hover:text-danger"
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        data-scanned-open={item.ean}
                        onClick={() => onOpenProduct(item.ean)}
                        className="block w-full text-left"
                      >
                        <span className="line-clamp-2 text-sm font-semibold text-text-primary">
                          {item.nombre}
                        </span>
                      </button>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
                        <span className="font-mono">{item.ean}</span>
                        {item.veces > 1 ? (
                          <span className="tnum rounded-full bg-surface px-1.5 font-semibold">
                            ×{item.veces}
                          </span>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tnum text-sm font-bold text-text-primary">
                        $ {item.precio.toLocaleString('es-AR')}
                      </span>
                      {enLista > 0 ? (
                        <div className="flex items-center rounded-full border border-border pl-0.5">
                          <button
                            type="button"
                            data-scanned-add={item.ean}
                            aria-label={addLabel}
                            title="Sumar otro"
                            onClick={() => onAdd(item)}
                            className="flex h-11 w-11 items-center justify-center text-accent"
                          >
                            <Plus size={18} aria-hidden="true" />
                          </button>
                          {/* Un divisor entre el `+` y el número: sin eso `+ 3` se
                              lee como un solo token ("sumá tres"), no como "acción |
                              cuántas tenés". Slot fijo de 24px para que 1, 2 o 3
                              dígitos no corran el control. */}
                          <span
                            data-scanned-qty={enLista}
                            className="tnum w-7 border-l border-border text-center text-xs font-semibold text-text-primary"
                          >
                            {enLista}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-scanned-add={item.ean}
                          aria-label={addLabel}
                          title="Agregar a la lista"
                          onClick={() => onAdd(item)}
                          className="flex h-11 w-11 items-center justify-center rounded-full border border-accent text-accent transition hover:bg-accent/10"
                        >
                          <Plus size={18} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
