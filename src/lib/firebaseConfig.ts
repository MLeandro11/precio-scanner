/**
 * firebaseConfig — reads and validates the Firebase Web config, with **no SDK import**.
 *
 * The values are not secrets: Firebase's `apiKey` is public by design (it identifies the
 * project, it does not authorise anything on its own). They come from Vite env vars so that
 * a clone with no `.env` behaves predictably instead of half-initialising an SDK.
 *
 * This module is deliberately free of `firebase/*` imports so the "is this build configured?"
 * decision is a pure function that unit tests in plain Node — and so the answer is known
 * without paying for the 34 kB gzip of the auth SDK.
 */

export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

/** The subset of `import.meta.env` this module reads, so tests can pass a plain object. */
export interface FirebaseEnv {
  VITE_FIREBASE_API_KEY?: string
  VITE_FIREBASE_AUTH_DOMAIN?: string
  VITE_FIREBASE_PROJECT_ID?: string
  VITE_FIREBASE_APP_ID?: string
}

/**
 * Config field → the env var that carries it. One table, so the two can never drift and a
 * test can iterate the required set instead of restating it.
 */
export const FIREBASE_ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const satisfies Record<keyof FirebaseConfig, keyof FirebaseEnv>

const CONFIG_FIELDS = Object.keys(FIREBASE_ENV_KEYS) as Array<keyof FirebaseConfig>

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Returns the config only when **every** required value is present and non-empty. Anything
 * missing yields `null`, which callers read as "this build has no auth configured" — never as
 * a partially initialised SDK.
 *
 * `null` is the ordinary case for a fresh clone, for CI, and for `scripts/acceptance.ts`, so
 * it is a first-class state rather than an error: throwing here would take the whole bundle
 * down at import time.
 */
export function readFirebaseConfig(env: FirebaseEnv): FirebaseConfig | null {
  const config: FirebaseConfig = {
    apiKey: clean(env[FIREBASE_ENV_KEYS.apiKey]),
    authDomain: clean(env[FIREBASE_ENV_KEYS.authDomain]),
    projectId: clean(env[FIREBASE_ENV_KEYS.projectId]),
    appId: clean(env[FIREBASE_ENV_KEYS.appId]),
  }
  return CONFIG_FIELDS.every((field) => config[field] !== '') ? config : null
}
