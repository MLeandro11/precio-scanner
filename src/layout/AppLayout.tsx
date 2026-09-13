import { NavLink, Outlet } from 'react-router-dom'
import { Bell, ClipboardList, Home, ScanBarcode, User } from 'lucide-react'

const TAB_CLASS =
  'flex flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[10px] font-medium transition'
const ACTIVE = 'bg-surface-sunken/5 text-accent'
const INACTIVE = 'text-text-muted'

function Tab({
  to,
  label,
  icon,
}: {
  to: string
  label: string
  icon: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `${TAB_CLASS} ${isActive ? ACTIVE : INACTIVE}`}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

/**
 * App layout: page content + the Lupa bottom navigation (outline style).
 *
 * Inicio · Alertas · [Escanear] · Lista · Perfil. Escanear is the primary
 * action: a filled green tile sits in the center of a floating rounded bar,
 * mirroring the product mockup.
 */
export default function AppLayout() {
  return (
    <div className="min-h-dvh bg-surface">
      <div className="pb-28">
        <Outlet />
      </div>

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-surface to-transparent px-3 pb-4 pt-2"
      >
        <div className="mx-auto flex w-full max-w-md items-center justify-between rounded-3xl border border-border bg-surface-raised px-2 py-2 shadow-lg">
          <Tab to="/" label="Inicio" icon={<Home size={20} strokeWidth={1.8} aria-hidden="true" />} />
          <Tab
            to="/alertas"
            label="Alertas"
            icon={<Bell size={20} strokeWidth={1.8} aria-hidden="true" />}
          />
          <NavLink
            to="/escanear"
            aria-label="Escanear código de barras"
            className="mx-1 flex flex-col items-center gap-1"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-contrast shadow-md">
              <ScanBarcode size={25} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className="text-[10px] font-semibold text-accent">Escanear</span>
          </NavLink>
          <Tab
            to="/lista"
            label="Lista"
            icon={<ClipboardList size={20} strokeWidth={1.8} aria-hidden="true" />}
          />
          <Tab
            to="/perfil"
            label="Perfil"
            icon={<User size={20} strokeWidth={1.8} aria-hidden="true" />}
          />
        </div>
      </nav>
    </div>
  )
}