import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { loadCatalog } from './lib/catalogLoader'
import { createWorkerClient } from './lib/workerClient'
import type { WorkerClient } from './lib/workerClient'
import type { Facets } from './lib/types'
import AppLayout from './layout/AppLayout'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
// ScanPage pulls in the webcam decoder (ZXing) — lazy-loaded so the ~400 kB
// decoder is only downloaded when the user actually opens /escanear.
const ScanPage = lazy(() => import('./pages/ScanPage'))
import ProductPage from './pages/ProductPage'
import HistoryPage from './pages/HistoryPage'
import ListPage from './pages/ListPage'
import PlaceholderPage from './pages/PlaceholderPage'
import SettingsPage from './pages/SettingsPage'
import Brand from './components/Brand'
import Button from './components/ui/Button'
import SkeletonList from './components/ui/Skeleton'

/**
 * Catalog boot context: the worker client owns the catalog; the main thread
 * only keeps the small facets. Booted once, shared by every route.
 */
interface CatalogContextValue {
  client: WorkerClient
  facets: Facets
}

const CatalogContext = createContext<CatalogContextValue | null>(null)

export function useCatalog(): CatalogContextValue {
  const value = useContext(CatalogContext)
  if (!value) throw new Error('useCatalog debe usarse dentro del CatalogProvider')
  return value
}

function BootScreen() {
  return (
    <div className="min-h-dvh bg-surface">
      <div className="safe-top mx-auto w-full max-w-lg px-4">
        <Brand />
        <div className="pb-3 pt-3" role="status" aria-live="polite">
          <span className="sr-only">Cargando catálogo…</span>
          <div className="skeleton h-11 w-full rounded-full" />
        </div>
        <SkeletonList />
      </div>
    </div>
  )
}

function ErrorScreen() {
  return (
    <div className="safe-top flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="text-center">
        <Brand />
        <p className="mt-3 text-sm text-danger">No se pudo cargar el catálogo.</p>
        <Button variant="primary" className="mt-4" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    </div>
  )
}

function SearchRoute() {
  const { client, facets } = useCatalog()
  return <SearchPage client={client} facets={facets} />
}

function AppRoutes() {
  return (
    <Suspense fallback={<ScanLoading />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/buscar" element={<SearchRoute />} />
          <Route path="/escanear" element={<ScanPage />} />
          <Route path="/producto/:ean" element={<ProductPage />} />
          <Route path="/historial/:ean" element={<HistoryPage />} />
          <Route path="/lista" element={<ListPage />} />
          <Route
            path="/alertas"
            element={
              <PlaceholderPage
                title="Alertas"
                description="Acá vas a recibir avisos cuando un producto baje de precio. Requiere datos de historial/multi-tienda que hoy no tenemos; modelo listo para cuando lleguen."
                icon={<Bell size={40} strokeWidth={1.5} aria-hidden="true" />}
              />
            }
          />
          <Route path="/perfil" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

/** Light loader shown while the webcam/scan chunk streams in. */
function ScanLoading() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-slate-900"
      role="status"
      aria-live="polite"
    >
      <span className="text-xs text-white/70">Cargando escáner…</span>
    </div>
  )
}

/**
 * Boot path (design §Large-catalog client handling):
 *   loadCatalog (cache/network) → worker init → ready.
 * The main thread touches the product array only to hand it to the worker at
 * boot; it never keeps a copy (the worker owns the catalog).
 */
export default function App() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [boot, setBoot] = useState<CatalogContextValue | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootCatalog() {
      try {
        const data = await loadCatalog()
        const client = createWorkerClient()
        await client.init(data)
        if (cancelled) return
        // `data` (incl. the big products array) goes out of scope here —
        // only the small facets survive on the main thread.
        setBoot({ client, facets: data.facets })
        setPhase('ready')
      } catch (err) {
        console.error('catalog boot failed', err)
        if (!cancelled) setPhase('error')
      }
    }

    bootCatalog()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'loading' || !boot) return <BootScreen />
  if (phase === 'error') return <ErrorScreen />

  return (
    <CatalogContext.Provider value={boot}>
      <AppRoutes />
    </CatalogContext.Provider>
  )
}