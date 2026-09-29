import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import Brand from '../components/Brand'
import CopyEanButton, { CopyAllEansButton } from '../components/CopyEanButton'
import { formatPrice } from '../components/ProductCard'
import Button from '../components/ui/Button'
import { useCatalog } from '../App'
import { describeFirestoreError, formatSavedDate, getSavedList } from '../lib/firestoreLists'
import type { SavedList } from '../lib/firestoreLists'
import type { ListaItem } from '../lib/lupa/list'
import { useAuth } from '../hooks/useAuth'
import { useList } from '../hooks/useList'
import { useResolveEans } from '../hooks/useResolveEans'

/** Stable identity, so `useResolveEans` does not re-run on every render while loading. */
const NO_ITEMS: ListaItem[] = []

type DetailState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; list: SavedList }

/**
 * Una lista guardada, en modo lectura (FR-12.4).
 *
 * This page's **only** mutator is `add`. There is no replace, no merge-all, no `clear` and no
 * `restoreAll` — so "opening a saved list cannot destroy unsaved work" is enforced by the
 * absence of the operation rather than by a confirmation dialog that a tired user can dismiss.
 * That is the whole design of FR-12.4, and it is why this file has no destructive branch.
 */
export default function SavedListDetailPage() {
  const { listId } = useParams<{ listId: string }>()
  const { client } = useCatalog()
  const { ready, user } = useAuth()
  const { add, isInList } = useList()
  const [state, setState] = useState<DetailState>({ status: 'loading' })

  const uid = user?.uid ?? null

  useEffect(() => {
    if (!ready) return
    if (!uid || !listId) {
      setState({ status: 'signed-out' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    getSavedList(uid, listId)
      .then((list) => {
        if (!alive) return
        setState(list ? { status: 'ready', list } : { status: 'missing' })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setState({ status: 'error', message: describeFirestoreError(err) })
      })
    return () => {
      alive = false
    }
  }, [ready, uid, listId])

  const items = state.status === 'ready' ? state.list.items : NO_ITEMS
  const eans = useMemo(() => items.map((i) => i.ean), [items])
  const products = useResolveEans(client, eans)

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <div className="flex items-center justify-between">
        <Brand />
        <Link
          to="/guardadas"
          className="text-xs font-medium text-text-secondary underline-offset-2 hover:underline"
        >
          ← Mis listas
        </Link>
      </div>

      <div data-saved-list-detail-state={state.status}>
        {state.status === 'loading' ? (
          <p className="mt-6 text-sm text-text-secondary" role="status">
            Cargando la lista…
          </p>
        ) : state.status === 'signed-out' ? (
          <p className="mt-6 text-sm text-text-secondary">
            Iniciá sesión para ver esta lista guardada.
          </p>
        ) : state.status === 'missing' ? (
          <p className="mt-6 text-sm text-text-secondary">
            Esa lista ya no existe. Puede que la hayas borrado.
          </p>
        ) : state.status === 'error' ? (
          <p role="alert" className="mt-6 text-sm text-danger">
            {state.message}
          </p>
        ) : (
          <>
            {/*
             * A <p>, not a second <h1>: Brand.tsx already renders the page's single
             * <h1> (the sr-only "Lupa" mark) on every route, so the list name stays
             * a styled paragraph and the document keeps one heading level.
             */}
            <p className="mt-6 text-lg font-extrabold text-text-primary">
              {state.list.nombre}
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              {state.list.items.length} producto{state.list.items.length === 1 ? '' : 's'}
              {formatSavedDate(state.list.creada) ? ` · ${formatSavedDate(state.list.creada)}` : ''}
            </p>

            {/*
             * Below the count line, not beside it: at 320px that line plus a
             * 44px control does not fit, and the bulk action is worth more at
             * the top of the list than a compact row. Fed by the same `eans`
             * memo the rows resolve against — no second derivation.
             */}
            <CopyAllEansButton eans={eans} className="mt-3" />

            <ul className="mt-4 space-y-2" data-saved-list-items={items.length}>
              {items.map((item, idx) => {
                const p = products[idx]
                /*
                 * The same fallback the working list already uses (`ListPage.tsx:126`). A
                 * snapshot outlives the catalog it was taken from, so an EAN that no longer
                 * resolves still gets a label instead of vanishing (FR-12.6).
                 */
                const name = p?.nombre ?? item.nombre ?? item.ean
                const price = p?.precio
                return (
                  <li
                    key={item.ean}
                    className="rounded-2xl border border-border bg-surface-raised p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
                        {/* The code is the copy control (D1). Copying is not a mutation,
                            so the page's read-only contract (FR-12.4) is untouched. */}
                        <CopyEanButton ean={item.ean} />
                        {/* The snapshot's own quantity is shown as history, because bringing the
                            item over uses the ordinary add — one unit, like any other add. */}
                        <p className="text-[11px] text-text-secondary">
                          Guardada con {item.cantidad} unidad{item.cantidad === 1 ? '' : 'es'}
                          {price != null ? ` · ${formatPrice(price)} c/u` : ''}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        className="shrink-0"
                        aria-label={`Agregar ${name} a mi lista`}
                        onClick={() => {
                          add(item.ean, name)
                          toast('Agregado a tu lista', { description: name })
                        }}
                      >
                        <Plus size={15} aria-hidden="true" />
                        {isInList(item.ean) ? 'Agregar otro' : 'Agregar'}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <p className="mt-4 rounded-xl border border-border bg-surface-raised p-3 text-[11px] text-text-secondary">
              Esta lista se abre en modo lectura: los productos entran a tu lista de trabajo de a
              uno, y nada de lo que ya tenías se pisa.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
