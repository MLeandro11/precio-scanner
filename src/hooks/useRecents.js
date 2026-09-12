import { useCallback, useRef, useState } from 'react'
import { getStored, setStored } from '../lib/storage.mjs'
import { addRecent as addRecentToList } from '../lib/collections.mjs'

/**
 * useRecents — the persisted recent-search queries (spec FR-5.2, AC-7).
 *
 * Read once at mount and written from `addRecent`, never from an effect: a mount
 * effect would write the initial state straight back and clobber queries stored
 * by an earlier session. All list math (dedupe, prefix replacement, cap) lives in
 * lib/collections.mjs so this stays a thin React adapter.
 *
 * `addRecent` is deliberately stable and reads the list through a ref. The search
 * session is created once inside a useMemo and captures this callback for the
 * lifetime of the app, so a callback closing over the render's `recents` array
 * would keep appending to the list as it was on the first render.
 */
export function useRecents({ storageKey = 'recents' } = {}) {
  const [recents, setRecents] = useState(() => {
    const stored = getStored(storageKey, [])
    // storage is user-writable: a non-array, or non-string entries, would throw
    return Array.isArray(stored) ? stored.filter((r) => typeof r === 'string') : []
  })
  const recentsRef = useRef(recents)

  const addRecent = useCallback(
    (query) => {
      const next = addRecentToList(recentsRef.current, query)
      recentsRef.current = next
      setStored(storageKey, next)
      setRecents(next)
    },
    [storageKey],
  )

  return { recents, addRecent }
}
