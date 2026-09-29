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
// Saved lists reach Firestore, and the hooks behind them load the Firebase SDK. Lazy so that
// code — and the SDK chunk — stays out of the main bundle and out of `/lista`.
const SavedListsPage = lazy(() => import('./pages/SavedListsPage'))
const SavedListDetailPage = lazy(() => import('./pages/SavedListDetailPage'))
import ProductPage from './pages/ProductPage'
import HistoryPage from './pages/HistoryPage'
import ListPage from './pages/ListPage'
import PlaceholderPage from './pages/PlaceholderPage'
import SettingsPage from './pages/SettingsPage'
import Brand from './components/Brand'
import Button from './components/ui/Button'
import SkeletonList from './components/ui/Skeleton'
import { describeCatalogError } from './lib/catalogError'

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
    // Own <main>: this screen renders before AppLayout mounts, so nothing else
    // provides the landmark.
    <main className="min-h-dvh bg-surface">
      <div className="safe-top mx-auto w-full max-w-lg px-4">
        <Brand />
        <div className="pb-3 pt-3" role="status" aria-live="polite">
          <span className="sr-only">Cargando catálogo…</span>
          <div className="skeleton h-11 w-full rounded-full" />
        </div>
        <SkeletonList />
      </div>
    </main>
  )
}

function ErrorScreen({ error }: { error: unknown }) {
  // A boot failure is a catalogLoader failure, so it gets the same cause +
  // recovery copy as the search error state (DESIGN.md: name the problem and
  // the recovery; the raw error text is never echoed).
  const { title, hint } = describeCatalogError(error)
  return (
    // Own <main>: same reason as BootScreen — AppLayout is not on screen here.
    <main
      className="safe-top flex min-h-dvh items-center justify-center bg-surface px-4"
      data-boot-state="error"
    >
      <div className="text-center">
        <Brand />
        <p className="mt-3 text-sm font-semibold text-danger">{title}</p>
        {hint ? <p className="mt-1 text-sm text-text-secondary">{hint}</p> : null}
        <Button variant="primary" className="mt-4" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    </main>
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
          <Route path="/guardadas" element={<SavedListsPage />} />
          <Route path="/guardadas/:listId" element={<SavedListDetailPage />} />
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
    // Own <main>: while a lazy chunk streams in, this fallback replaces the whole
    // <Routes> tree — AppLayout (and its <main>) are not rendered yet.
    <main
      className="flex min-h-dvh items-center justify-center bg-slate-900"
      role="status"
      aria-live="polite"
    >
      <span className="text-xs text-white/70">Cargando escáner…</span>
    </main>
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
  const [bootError, setBootError] = useState<unknown>(null)

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
        // Kept for the maintainer: the raw error (URLs, statuses) never reaches
        // the user; ErrorScreen renders only the mapper's named cause.
        console.error('catalog boot failed', err)
        if (!cancelled) {
          setBootError(err)
          setPhase('error')
        }
      }
    }

    bootCatalog()
    return () => {
      cancelled = true
    }
  }, [])

  /*
   * Order rule: the failed-boot branch MUST be checked before the loading
   * skeleton. On a boot failure `boot` stays null, so if `!boot` were
   * evaluated first the app would render BootScreen forever — phase ===
   * 'error' would be unreachable (the original defect). Do not reorder these
   * two guards back to loading-first.
   */
  if (phase === 'error') return <ErrorScreen error={bootError} />
  if (phase === 'loading' || !boot) return <BootScreen />

  return (
    <CatalogContext.Provider value={boot}>
      <AppRoutes />
    </CatalogContext.Provider>
  )
}