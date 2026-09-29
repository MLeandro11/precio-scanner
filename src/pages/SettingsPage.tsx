import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import Brand from '../components/Brand'
import LupaLockup from '../components/LupaLockup'
import Button from '../components/ui/Button'
import { useTheme } from '../hooks/useTheme'
import type { ThemePreference } from '../hooks/useTheme'
import { useAuth } from '../hooks/useAuth'
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
  const { configured, user, ready, error, signIn, signOut } = useAuth()

  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4 pb-8">
      <Brand />
      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Cuenta
      </h2>

      <div className="mt-2 rounded-xl border border-border bg-surface-raised p-4">
        {!configured ? (
          <p className="text-xs text-text-secondary">
            Este build no tiene Firebase configurado. Definí las variables{' '}
            <code className="text-text-secondary">VITE_FIREBASE_*</code> para habilitar el login.
          </p>
        ) : !ready ? (
          <p className="text-sm text-text-secondary">Cargando sesión…</p>
        ) : user ? (
          <>
            <div className="flex items-center gap-3">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt=""
                  aria-hidden="true"
                  width={40}
                  height={40}
                  /* The provider avatar is a third-party request; no referrer and no
                     credentials cross the boundary for it. */
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 shrink-0 rounded-full bg-surface object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text-primary">
                  {user.displayName ?? 'Sesión iniciada'}
                </p>
                {user.email ? (
                  <p className="truncate text-xs text-text-secondary">{user.email}</p>
                ) : null}
              </div>
            </div>
            <Button variant="secondary" className="mt-4 w-full" onClick={signOut}>
              <LogOut size={16} aria-hidden="true" /> Cerrar sesión
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-text-primary">Iniciá sesión</p>
            <p className="mt-1 text-xs text-text-secondary">
              Con tu cuenta de Google. Te identifica, y guarda tus listas solo cuando se lo pedís.
            </p>
            <div className="mt-3">
              <Button variant="secondary" className="w-full" onClick={signIn}>
                Continuar con Google
              </Button>
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        Apariencia
      </h2>

      <div
        className="mt-2 flex rounded-xl border border-border bg-surface-raised p-1"
        role="radiogroup"
        aria-label="Tema de la aplicación"
        /* Completed ARIA radio pattern: roving tabindex (only the checked
           radio is tabbable) + Arrow/Home/End moves selection and focus, as
           the ARIA contract requires. */
        onKeyDown={(e) => {
          const idx = OPTIONS.findIndex((o) => o.value === theme)
          const move = (next: number) => {
            e.preventDefault()
            const option = OPTIONS[(next + OPTIONS.length) % OPTIONS.length]
            setTheme(option.value)
            document.getElementById(`tema-${option.value}`)?.focus()
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(idx + 1)
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(idx - 1)
          else if (e.key === 'Home') move(0)
          else if (e.key === 'End') move(OPTIONS.length - 1)
        }}
      >
        {OPTIONS.map((o) => {
          const active = theme === o.value
          return (
            <button
              key={o.value}
              id={`tema-${o.value}`}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setTheme(o.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg min-h-11 px-2 text-sm font-medium transition ${
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

      <p className="mt-3 text-xs text-text-secondary">
        "Sistema" usa el tema claro u oscuro de tu dispositivo.
      </p>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-text-secondary">
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
              <span className="text-text-secondary">{row.label}</span>
              <span className="text-text-secondary">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}