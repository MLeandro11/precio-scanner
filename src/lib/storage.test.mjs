import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getStored, setStored, STORAGE_PREFIX } from './storage.mjs'

// localStorage does not exist in Node: stub it with an in-memory map
function stubLocalStorage() {
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  })
  return store
}

describe('storage', () => {
  beforeEach(() => {
    stubLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores and reads JSON-safe values under the namespaced key', () => {
    setStored('recents', ['yerba', 'fideos'])
    expect(getStored('recents', [])).toEqual(['yerba', 'fideos'])
  })

  it('returns the default when the key is missing or corrupt', () => {
    expect(getStored('nada', 'fallback')).toBe('fallback')
    localStorage.setItem(`${STORAGE_PREFIX}roto`, '{no json')
    expect(getStored('roto', [])).toEqual([])
  })

  it('survives storage failures (private mode) without throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(getStored('x', null)).toBeNull()
    expect(() => setStored('x', { a: 1 })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
