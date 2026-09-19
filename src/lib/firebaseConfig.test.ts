import { describe, it, expect } from 'vitest'
import { readFirebaseConfig, FIREBASE_ENV_KEYS } from './firebaseConfig'
import type { FirebaseEnv } from './firebaseConfig'

const FULL: FirebaseEnv = {
  VITE_FIREBASE_API_KEY: 'api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo',
  VITE_FIREBASE_APP_ID: '1:2:web:3',
}

const ENV_VARS = Object.values(FIREBASE_ENV_KEYS)

describe('readFirebaseConfig', () => {
  it('returns the config when every required value is present', () => {
    expect(readFirebaseConfig(FULL)).toEqual({
      apiKey: 'api-key',
      authDomain: 'demo.firebaseapp.com',
      projectId: 'demo',
      appId: '1:2:web:3',
    })
  })

  it('trims surrounding whitespace, which is what a copied .env actually contains', () => {
    expect(readFirebaseConfig({ ...FULL, VITE_FIREBASE_API_KEY: '  api-key  ' })?.apiKey).toBe(
      'api-key',
    )
  })

  it.each(ENV_VARS)('returns null when %s is absent', (variable) => {
    const partial: FirebaseEnv = { ...FULL }
    delete partial[variable]
    expect(readFirebaseConfig(partial)).toBeNull()
  })

  it.each(ENV_VARS)('returns null when %s is empty or whitespace only', (variable) => {
    expect(readFirebaseConfig({ ...FULL, [variable]: '' })).toBeNull()
    expect(readFirebaseConfig({ ...FULL, [variable]: '   ' })).toBeNull()
  })

  it('returns null for an entirely empty environment — the CI and acceptance case', () => {
    expect(readFirebaseConfig({})).toBeNull()
  })

  it('ignores non-string values instead of coercing them', () => {
    // a hand-edited or badly generated env file can carry a number here
    const env = { ...FULL, VITE_FIREBASE_PROJECT_ID: 42 as unknown as string }
    expect(readFirebaseConfig(env)).toBeNull()
  })
})
