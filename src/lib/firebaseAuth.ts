import type { Auth } from 'firebase/auth'
import { readFirebaseConfig } from './firebaseConfig'
import type { FirebaseConfig } from './firebaseConfig'

/**
 * firebaseAuth — loads the Firebase SDK on demand.
 *
 * `firebase/auth` costs roughly 34 kB gzip and is worth nothing to the app's main job
 * (searching prices), so it is imported only when someone actually opens the account screen.
 * `ScanPage` is lazy-loaded for exactly the same reason.
 *
 * The promise is memoised so the SDK loads once per session however many callers ask for it,
 * and a **failure is not memoised as a success** — a retry after a flaky network must be able
 * to try again.
 */

export interface AuthClient {
  auth: Auth
  config: FirebaseConfig
  mod: typeof import('firebase/auth')
}

let loading: Promise<AuthClient | null> | null = null

/** Resolves to `null` when this build has no Firebase config, which is the normal case in CI. */
export function getAuthClient(): Promise<AuthClient | null> {
  const config = readFirebaseConfig(import.meta.env)
  if (!config) return Promise.resolve(null)
  if (!loading) {
    loading = load(config).catch((err: unknown) => {
      loading = null
      throw err
    })
  }
  return loading
}

async function load(config: FirebaseConfig): Promise<AuthClient> {
  const [appMod, authMod] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  const app = appMod.initializeApp(config)
  return { auth: authMod.getAuth(app), config, mod: authMod }
}
