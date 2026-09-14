import { Monitor, Moon, Sun } from 'lucide-react'
import Brand from '../components/Brand'
import { useTheme } from '../hooks/useTheme'
import type { ThemePreference } from '../hooks/useTheme'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: React.ReactNode }> = [
  { value: 'system', label: 'Sistema', icon: <Monitor size={16} aria-hidden="true" /> },
  { value: 'light', label: 'Claro', icon: <Sun size={16} aria-hidden="true" /> },
  { value: 'dark', label: 'Oscuro', icon: <Moon size={16} aria-hidden="true" /> },
]

/**
 * Perfil — a small settings page (other profile features are still pending; the
 * theme selector is the concrete control here). "Sistema" follows the device.
 */
export default function SettingsPage() {
  const [theme, setTheme] = useTheme()

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <Brand />
      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Apariencia
      </h2>

      <div
        className="mt-2 flex rounded-xl border border-border bg-surface-raised p-1"
        role="radiogroup"
        aria-label="Tema de la aplicación"
      >
        {OPTIONS.map((o) => {
          const active = theme === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(o.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-surface-sunken text-accent-contrast shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {o.icon}
              {o.label}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-text-muted">
        "Sistema" usa el tema claro u oscuro de tu dispositivo.
      </p>
    </main>
  )
}