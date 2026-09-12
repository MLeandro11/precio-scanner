/**
 * collections — pure list math for the two persisted collections (spec FR-5.1/5.2).
 *
 * Favorites and recent searches are plain id/query arrays that `lib/storage.mjs`
 * persists; keeping their rules here (dedupe, prefix replacement, cap, no
 * mutation) makes them unit-testable in Node with no storage, DOM, or React.
 */

export const RECENTS_CAP = 10
export const RECENTS_MIN_LENGTH = 2

function equalsQuery(a, b) {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * The debounce (150 ms) means a slow typist commits "coca", then "cocac", then
 * "cocacola": without this rule the recents fill with prefixes of one search.
 * Only the NEW query extending an OLD entry collapses; the reverse order
 * (adding "coca" after "cocacola") keeps both.
 */
function isProperPrefix(oldQuery, nextQuery) {
  const old = oldQuery.toLowerCase()
  const next = nextQuery.toLowerCase()
  return old.length < next.length && next.startsWith(old)
}

/**
 * @param {string[]} recents
 * @param {string} query
 * @returns {string[]} a new array; the input is never mutated
 */
export function addRecent(
  recents,
  query,
  { cap = RECENTS_CAP, minLength = RECENTS_MIN_LENGTH } = {},
) {
  const next = String(query ?? '').trim()
  if (next.length < minLength) return recents.slice()

  const kept = recents.filter((r) => !equalsQuery(r, next) && !isProperPrefix(r, next))
  return [next, ...kept].slice(0, cap)
}

/**
 * @param {string[]} favorites
 * @param {string} id
 * @returns {string[]} a new array; the input is never mutated
 */
export function toggleFavorite(favorites, id) {
  if (!id) return favorites.slice()
  return favorites.includes(id)
    ? favorites.filter((f) => f !== id)
    : [...favorites, id]
}

/**
 * @param {string[]} favorites
 * @param {string} id
 * @returns {boolean}
 */
export function isFavorite(favorites, id) {
  return favorites.includes(id)
}
