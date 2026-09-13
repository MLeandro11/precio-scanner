import { useCallback, useState } from 'react'
import { getStored, setStored } from '../lib/storage'
import {
  isFavorite as isFavoriteInList,
  toggleFavorite as toggleFavoriteInList,
} from '../lib/collections'

/**
 * useFavorites — the persisted favorite product ids (spec FR-5.1, AC-7).
 *
 * The list is read once at mount and written from the toggle handler, never
 * from an effect: a mount effect would write the initial state straight back
 * and clobber ids stored by an earlier session. All list math lives in
 * lib/collections.ts so this stays a thin React adapter.
 */
interface UseFavoritesOptions {
  storageKey?: string
}

export function useFavorites({ storageKey = 'favorites' }: UseFavoritesOptions = {}) {
  const [favorites, setFavorites] = useState<string[]>(() => {
    const stored = getStored<unknown>(storageKey, [])
    // storage is user-writable: a non-array value would break every .includes
    return Array.isArray(stored) ? stored.filter((v): v is string => typeof v === 'string') : []
  })

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = toggleFavoriteInList(favorites, id)
      setStored(storageKey, next)
      setFavorites(next)
    },
    [favorites, storageKey],
  )

  const isFavorite = useCallback((id: string) => isFavoriteInList(favorites, id), [favorites])

  return { favorites, isFavorite, toggleFavorite }
}