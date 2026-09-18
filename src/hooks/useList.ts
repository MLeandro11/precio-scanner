import { useCallback, useEffect, useRef, useState } from 'react'
import { getStored, setStored, STORAGE_PREFIX } from '../lib/storage'
import {
  addItem as addItemTo, 
  removeItem as removeItemFrom, 
  restoreItem as restoreItemTo,
  restoreList as restoreListTo,
  setCantidad as setCantidadIn, 
  toggleAlerta as toggleAlertaIn,
  clearList,
  LIST_STORAGE_KEY,
} from '../lib/lupa/list'
import type { ListaItem } from '../lib/lupa/list'

/**
 * Cross-instance change signal, same document only. `useList` holds per-instance
 * state, so the layout route (AppLayout) would never see a list changed by a page
 * hook without this. Other tabs are covered by the native `storage` event below.
 */
export const LIST_CHANGE_EVENT = 'lupa:lista-change'

/**
 * The single shape guard for a persisted list: the initial read and every sync
 * path go through it, so they cannot drift apart.
 */
function parseListaItems(value: unknown): ListaItem[] {
  return Array.isArray(value)
    ? value.filter(
        (it): it is ListaItem =>
          typeof it === 'object' &&
          it !== null &&
          typeof (it as ListaItem).ean === 'string' &&
          typeof (it as ListaItem).cantidad === 'number',
      )
    : []
}

/** The only read path: parse + validate what is persisted right now. */
function readStoredList(): ListaItem[] {
  return parseListaItems(getStored<unknown>(LIST_STORAGE_KEY, []))
}

/**
 * useList — persisted shopping list (localStorage), the same thin-adapter
 * pattern as useRecents/useFavorites. All list math lives in lib/lupa/list.ts;
 * the ref keeps `add`/`remove` stable so other hooks can capture them once.
 *
 * Every mounted instance stays in sync: `commit` broadcasts the next list and the
 * other hooks adopt it, which is what lets a badge living in the (never
 * unmounting) layout route react to an item added from a page route.
 */
export function useList() {
  const [items, setItems] = useState<ListaItem[]>(readStoredList)
  const itemsRef = useRef(items)

  const commit = useCallback((next: ListaItem[]) => {
    itemsRef.current = next
    setStored(LIST_STORAGE_KEY, next)
    setItems(next)
    window.dispatchEvent(new CustomEvent(LIST_CHANGE_EVENT, { detail: next }))
  }, [])

  useEffect(() => {
    // A sibling instance committed: adopt its list. The instance that committed
    // receives its own event too; `setItems` with the array it already holds is a
    // same-reference update, which React bails out of (no extra render).
    function onListaChange(event: Event) {
      const next = parseListaItems((event as CustomEvent<unknown>).detail)
      itemsRef.current = next
      setItems(next)
    }
    // Another tab wrote the same key (the custom event is document-scoped).
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_PREFIX + LIST_STORAGE_KEY) return
      const next = readStoredList()
      itemsRef.current = next
      setItems(next)
    }
    window.addEventListener(LIST_CHANGE_EVENT, onListaChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LIST_CHANGE_EVENT, onListaChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const add = useCallback(
    (ean: string, nombre?: string) => commit(addItemTo(itemsRef.current, ean, nombre)),
    [commit],
  )
  const remove = useCallback(
    (ean: string) => commit(removeItemFrom(itemsRef.current, ean)),
    [commit],
  )
  const restore = useCallback(
    (item: ListaItem, index: number) => commit(restoreItemTo(itemsRef.current, item, index)),
    [commit],
  )
  const restoreAll = useCallback(
    (snapshot: ListaItem[]) => commit(restoreListTo(parseListaItems(snapshot), itemsRef.current)),
    [commit],
  )
  const setCantidad = useCallback(
    (ean: string, cantidad: number) => commit(setCantidadIn(itemsRef.current, ean, cantidad)),
    [commit],
  )
  const toggleAlerta = useCallback(
    (ean: string) => commit(toggleAlertaIn(itemsRef.current, ean)),
    [commit],
  )

  const clear = useCallback(() => commit(clearList()), [commit])

  const isInList = useCallback((ean: string) => itemsRef.current.some((i) => i.ean === ean), [])

  return { items, add, remove, restore, restoreAll, setCantidad, toggleAlerta, clear, isInList }
}

export type ListControls = ReturnType<typeof useList>