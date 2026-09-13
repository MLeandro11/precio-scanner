import { describe, it, expect } from 'vitest'
import {
  RECENTS_CAP,
  RECENTS_MIN_LENGTH,
  addRecent,
  toggleFavorite,
  isFavorite,
} from './collections'

describe('collections.addRecent', () => {
  it('is a no-op below the minimum query length', () => {
    expect(addRecent(['yerba'], 'c')).toEqual(['yerba'])
    expect(RECENTS_MIN_LENGTH).toBe(2)
  })

  it('ignores whitespace-only queries', () => {
    expect(addRecent(['yerba'], '   ')).toEqual(['yerba'])
    expect(addRecent(['yerba'], '\t\n')).toEqual(['yerba'])
  })

  it('stores the trimmed query', () => {
    expect(addRecent([], '  coca  ')).toEqual(['coca'])
  })

  it('dedupes case-insensitively: the new casing wins and moves to the front', () => {
    expect(addRecent(['coca', 'yerba'], 'COCA')).toEqual(['COCA', 'yerba'])
  })

  it('drops proper prefixes of the new query (debounced slow typing)', () => {
    // every intermediate commit is a prefix of the next one → only the last survives
    expect(addRecent(addRecent([], 'coca'), 'cocac')).toEqual(['cocac'])
    expect(addRecent(addRecent(addRecent([], 'coca'), 'cocac'), 'cocacola')).toEqual([
      'cocacola',
    ])
  })

  it('keeps unrelated entries when dropping a prefix', () => {
    expect(addRecent(['yerba', 'coca'], 'cocacola')).toEqual(['cocacola', 'yerba'])
  })

  it('keeps both when the new query is a prefix of an existing entry', () => {
    expect(addRecent(['cocacola'], 'coca')).toEqual(['coca', 'cocacola'])
  })

  it(`caps the list at ${RECENTS_CAP}, dropping the oldest`, () => {
    let recents: string[] = []
    for (let i = 0; i < RECENTS_CAP + 3; i++) {
      recents = addRecent(recents, `query-${i}`)
    }
    expect(recents).toHaveLength(RECENTS_CAP)
    expect(recents[0]).toBe(`query-${RECENTS_CAP + 2}`)
    expect(recents).not.toContain('query-0')
  })

  it('honors a custom cap and minLength', () => {
    expect(addRecent([], 'ab', { minLength: 3 })).toEqual([])
    const two = addRecent(addRecent([], 'uno', { cap: 2 }), 'dos', { cap: 2 })
    expect(addRecent(two, 'tres', { cap: 2 })).toEqual(['tres', 'dos'])
  })

  it('never mutates the input array', () => {
    const recents = ['yerba']
    const next = addRecent(recents, 'coca')
    expect(next).toEqual(['coca', 'yerba'])
    expect(next).not.toBe(recents)
    expect(recents).toEqual(['yerba'])
  })
})

describe('collections.toggleFavorite', () => {
  it('appends a new id at the end', () => {
    expect(toggleFavorite(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removes an id that is already present', () => {
    expect(toggleFavorite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('returns the input unchanged for a falsy id', () => {
    const favorites = ['a']
    for (const falsy of ['', null, undefined, 0]) {
      expect(toggleFavorite(favorites, falsy as string)).toEqual(['a'])
    }
  })

  it('never mutates the input array', () => {
    const favorites = ['a']
    expect(toggleFavorite(favorites, 'b')).not.toBe(favorites)
    expect(toggleFavorite(favorites, 'a')).not.toBe(favorites)
    expect(favorites).toEqual(['a'])
  })
})

describe('collections.isFavorite', () => {
  it('reports membership as a boolean', () => {
    expect(isFavorite(['a', 'b'], 'a')).toBe(true)
    expect(isFavorite(['a', 'b'], 'z')).toBe(false)
    expect(isFavorite([], 'a')).toBe(false)
  })
})
