import { Monitor, Moon, Sun } from 'lucide-react'
import Brand from '../components/Brand'
import LupaLockup from '../components/LupaLockup'
import { useTheme } from '../hooks/useTheme'
import type { ThemePreference } from '../hooks/useTheme'
import { version } from '../../package.json'

/**
 * "Acerca de" facts. There is deliberately no product count here: the shipped total
 * changes every time the data pipeline is regenerated (`npm run normalize` /
 * `npm run generate-index`), and `public/data/catalogo-facets.json` exposes no product
 * total, so there is no cheap runtime source for it.
 */
const ABOUT: Array<{ label: string; value: string }> = [
  { label: 'Versión', value: version },
  { label: 'Datos', value: 'Precios Claros' },
  { label: 'Tiendas', value: '1' },
]

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

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Acerca de
      </h2>

      <div className="mt-2 rounded-xl border border-border bg-surface-raised p-4">
        <div className="flex justify-center text-text-primary">
          {/* Full lockup: the L plus its barcode, centered as the card's hero. It is
              decorative because the page header above already announces "Lupa". */}
          <LupaLockup variant="full" height={65} gap={13} decorative />
        </div>

        <div className="mt-4 space-y-2">
          {ABOUT.map((row) => (
            <div key={row.label} className="flex items-center justify-between text-[13px]">
              <span className="text-text-muted">{row.label}</span>
              <span className="text-text-secondary">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}