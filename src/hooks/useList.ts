import { useCallback, useRef, useState } from 'react'
import { getStored, setStored } from '../lib/storage'
import {
  addItem as addItemTo, 
  removeItem as removeItemFrom, 
  setCantidad as setCantidadIn, 
  toggleAlerta as toggleAlertaIn, 
  LIST_STORAGE_KEY, 
} from '../lib/lupa/list'
import type { ListaItem } from '../lib/lupa/list'

/**
 * useList — persisted shopping list (localStorage), the same thin-adapter
 * pattern as useRecents/useFavorites. All list math lives in lib/lupa/list.ts;
 * the ref keeps `add`/`remove` stable so other hooks can capture them once.
 */
export function useList() {
  const [items, setItems] = useState<ListaItem[]>(() => {
    const stored = getStored<unknown>(LIST_STORAGE_KEY, [])
    return Array.isArray(stored)
      ? stored.filter(
          (it): it is ListaItem =>
            typeof it === 'object' &&
            it !== null &&
            typeof (it as ListaItem).ean === 'string' &&
            typeof (it as ListaItem).cantidad === 'number',
        )
      : []
  })
  const itemsRef = useRef(items)

  const commit = useCallback((next: ListaItem[]) => {
    itemsRef.current = next
    setStored(LIST_STORAGE_KEY, next)
    setItems(next)
  }, [])

  const add = useCallback(
    (ean: string, nombre?: string) => commit(addItemTo(itemsRef.current, ean, nombre)),
    [commit],
  )
  const remove = useCallback(
    (ean: string) => commit(removeItemFrom(itemsRef.current, ean)),
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

  const isInList = useCallback((ean: string) => itemsRef.current.some((i) => i.ean === ean), [])

  return { items, add, remove, setCantidad, toggleAlerta, isInList }
}

export type ListControls = ReturnType<typeof useList>