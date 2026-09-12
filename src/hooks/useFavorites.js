import { useState } from 'react'
import { getStored, setStored } from '../lib/storage.mjs'
import {
  isFavorite as isFavoriteInList,
  toggleFavorite as toggleFavoriteInList,
} from '../lib/collections.mjs'

/**
 * useFavorites — the persisted favorite product ids (spec FR-5.1, AC-7).
 *
 * The list is read once at mount and written from the toggle handler, never
 * from an effect: a mount effect would write the initial state straight back
 * and clobber ids stored by an earlier session. All list math lives in
 * lib/collections.mjs so this stays a thin React adapter.
 */
export function useFavorites({ storageKey = 'favorites' } = {}) {
  const [favorites, setFavorites] = useState(() => {
    const stored = getStored(storageKey, [])
    // storage is user-writable: a non-array value would break every .includes
    return Array.isArray(stored) ? stored : []
  })

  function toggleFavorite(id) {
    const next = toggleFavoriteInList(favorites, id)
    setStored(storageKey, next)
    setFavorites(next)
  }

  return {
    favorites,
    isFavorite: (id) => isFavoriteInList(favorites, id),
    toggleFavorite,
  }
}
