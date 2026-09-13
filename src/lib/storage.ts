/**
 * storage — JSON-safe localStorage with a `precio-scanner:` namespace.
 * All failures (quota, private mode, corrupt JSON) degrade to defaults.
 */
export const STORAGE_PREFIX = 'precio-scanner:'

export function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode / quota): silently degrade
  }
}