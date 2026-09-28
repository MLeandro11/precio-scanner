import { useCallback, useEffect, useState } from 'react'
import {
  deleteSavedList,
  describeFirestoreError,
  listSavedLists,
  restoreSavedList,
  saveList,
} from '../lib/firestoreLists'
import type { SavedList } from '../lib/firestoreLists'
import type { ListaItem } from '../lib/lupa/list'
import { useAuth } from './useAuth'

/**
 * The saved-lists screen has five states and they are kept apart on purpose. An unreachable
 * backend, an empty account and a build with no Firebase at all are three different facts,
 * and FR-12.9 only holds if the UI can tell them apart — "no tenés listas guardadas" is a lie
 * when the read simply failed.
 */
export type SavedListsState =
  | { status: 'unconfigured' }
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'ready'; lists: SavedList[] }
  | { status: 'error'; message: string }

export interface SavedListsControls {
  state: SavedListsState
  /** A failed save or delete. Kept apart from `state` so a failure never wipes the list view. */
  actionError: string | null
  reload: () => Promise<void>
  save: (nombre: string, items: ListaItem[]) => Promise<boolean>
  remove: (list: SavedList) => Promise<boolean>
  restore: (list: SavedList) => Promise<boolean>
  signIn: () => Promise<void>
}

/**
 * useSavedLists — the signed-in user's saved lists, read on demand.
 *
 * This hook is the only thing in the app that reaches Firestore, and reaching it is what
 * loads the Firebase SDK. That is precisely why `ListPage` does not use it: `/lista` is a
 * core route, and making it pull a lazily-fetched chunk that is deliberately outside the
 * precache would cost every list visit ~46 kB and give the route a new offline failure mode.
 * The save action therefore lives on `/guardadas`, where the session is already loaded.
 */
export function useSavedLists(): SavedListsControls {
  const { configured, user, ready, signIn } = useAuth()
  const [state, setState] = useState<SavedListsState>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const uid = user?.uid ?? null

  const reload = useCallback(async () => {
    if (!uid) {
      setState({ status: 'signed-out' })
      return
    }
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', lists: await listSavedLists(uid) })
    } catch (err) {
      setState({ status: 'error', message: describeFirestoreError(err) })
    }
  }, [uid])

  useEffect(() => {
    if (!configured) {
      setState({ status: 'unconfigured' })
      return
    }
    // `ready` stays false until the lazily-loaded SDK reports the restored session. Treating
    // that as "signed out" would flash the sign-in prompt at a returning user.
    if (!ready) return
    void reload()
  }, [configured, ready, reload])

  const run = useCallback(
    async (work: (uid: string) => Promise<unknown>): Promise<boolean> => {
      if (!uid) return false
      setActionError(null)
      try {
        await work(uid)
        await reload()
        return true
      } catch (err) {
        setActionError(describeFirestoreError(err))
        return false
      }
    },
    [uid, reload],
  )

  const save = useCallback(
    (nombre: string, items: ListaItem[]) => run((id) => saveList(id, nombre, items)),
    [run],
  )

  const remove = useCallback(
    (list: SavedList) => run((id) => deleteSavedList(id, list.id)),
    [run],
  )

  const restore = useCallback(
    (list: SavedList) => run((id) => restoreSavedList(id, list)),
    [run],
  )

  return { state, actionError, reload, save, remove, restore, signIn }
}
