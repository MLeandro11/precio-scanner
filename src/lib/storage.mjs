/**
 * storage — JSON-safe localStorage with a `precio-scanner:` namespace.
 * All failures (quota, private mode, corrupt JSON) degrade to defaults.
 */
export const STORAGE_PREFIX = 'precio-scanner:'

export function getStored(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function setStored(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode / quota): silently degrade
  }
}
