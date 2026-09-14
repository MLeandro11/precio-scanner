import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'lupa:theme'
const THEME_COLOR_LIGHT = '#15803d'
const THEME_COLOR_DARK = '#0f172a'

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable — fall through to system */
  }
  return 'system'
}

/** Reflects the schema on <html>: data-theme is the manual override; absent = system. */
function applyTheme(theme: ThemePreference) {
  const el = document.documentElement
  if (theme === 'light' || theme === 'dark') {
    el.setAttribute('data-theme', theme)
  } else {
    el.removeAttribute('data-theme')
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    meta.setAttribute('content', dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT)
  }
}

/**
 * Dark/light theme preference. Persisted in localStorage ('lupa:theme').
 * 'system' follows the device prefers-color-scheme.
 * The boot script in index.html already sets the attribute pre-paint; this keeps
 * it in sync with React state after mount.
 */
export function useTheme(): [ThemePreference, (t: ThemePreference) => void] {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStored())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((t: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* storage unavailable — still apply for this session */
    }
    setThemeState(t)
  }, [])

  return [theme, setTheme]
}