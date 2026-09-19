import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { getAuthClient } from '../lib/firebaseAuth'
import { describeAuthError, isSilentAuthCode } from '../lib/authMessages'
import { readFirebaseConfig } from '../lib/firebaseConfig'

export type AuthProviderId = 'google' | 'github'

/**
 * useAuth — the Firebase session as a thin React adapter.
 *
 * `onAuthStateChanged` is the single source of truth: it fires once with the restored session
 * (or `null`) and again on every change, so there is no second "am I logged in" flag to keep
 * in sync. Returning the unsubscribe matters — React 19 StrictMode mounts effects twice in dev.
 *
 * The SDK arrives lazily, so `ready` stays false until it lands. A caller must render a pending
 * state; treating `!ready` as "signed out" would flash the sign-in buttons at a returning user.
 */
export function useAuth() {
  const configured = readFirebaseConfig(import.meta.env) !== null
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!configured)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!configured) return
    let alive = true
    let unsubscribe: (() => void) | undefined

    getAuthClient()
      .then((client) => {
        if (!alive || !client) return
        unsubscribe = client.mod.onAuthStateChanged(client.auth, (next) => {
          setUser(next)
          setReady(true)
        })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(describeAuthError((err as { code?: unknown })?.code))
        setReady(true)
      })

    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [configured])

  const signIn = useCallback(async (id: AuthProviderId) => {
    setError(null)
    const client = await getAuthClient()
    if (!client) return
    const provider =
      id === 'google' ? new client.mod.GoogleAuthProvider() : new client.mod.GithubAuthProvider()
    try {
      await client.mod.signInWithPopup(client.auth, provider)
    } catch (err: unknown) {
      const code = (err as { code?: unknown })?.code
      // Closing the popup is a decision, not a failure worth an error message.
      if (isSilentAuthCode(code)) return
      setError(describeAuthError(code))
    }
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    const client = await getAuthClient()
    await client?.mod.signOut(client.auth)
  }, [])

  return { configured, user, ready, error, signIn, signOut }
}
