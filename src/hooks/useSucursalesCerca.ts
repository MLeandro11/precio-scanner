import { useEffect, useState } from 'react'
import { createPreciosClarosClient } from '../lib/preciosClaros/client'
import type { PreciosClarosClient, PreciosClarosError } from '../lib/preciosClaros/client'
import { mapSucursales } from '../lib/preciosClaros/map'
import type { SucursalPrecio } from '../lib/preciosClaros/map'
import { deriveEstado } from '../lib/preciosClaros/estado'
import type { EstadoSucursales } from '../lib/preciosClaros/estado'

export type SucursalesCercaStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SucursalesCercaOptions {
  /** EAN to look up. When null/empty, the hook stays 'idle' and never fetches. */
  ean: string | null
  /** Coordinates. When null, the hook stays 'idle' and never fetches. */
  coords: { lat: number; lng: number } | null
  /** Injectable for tests. When omitted, a single memoized client is used. */
  client?: PreciosClarosClient
}

export interface SucursalesCercaState {
  status: SucursalesCercaStatus
  /** Non-null only when status is 'ready'. */
  estado: EstadoSucursales | null
  /** Ordered by price ascending (as `mapSucursales` returns it). Empty unless ready. */
  sucursales: SucursalPrecio[]
  /** The typed failure when status is 'error', for debugging/copy selection. */
  error: PreciosClarosError | Error | null
}

/**
 * useSucursalesCerca — fetches the per-branch prices for one EAN once the user
 * has coordinates, and folds the response into the three UI states the
 * product-detail screen renders.
 *
 * Why the idle gate is the whole point: `useUbicacion` deliberately never asks
 * for a position on mount, so this hook must not spend a request before the user
 * taps either. It stays `'idle'` and touches no client until BOTH an EAN and
 * coordinates exist; that is what keeps the browser permission prompt expected
 * instead of hostile, end to end.
 *
 * Why the default client lives at module scope: an effect dependency on a client
 * built during render would hand the effect a fresh identity every render and
 * refetch forever. One module-level client keeps the dependency stable, so the
 * request happens exactly once per (ean, coords) pair — no retry, no backoff,
 * no polling. Callers keep their own storage (location stays in memory), so the
 * hook owns nothing here.
 *
 * Why a response is never an error: an unknown EAN or a page with no priced
 * branch is a normal answer (`deriveEstado`), not a failure; the component keeps
 * showing the local catalog price. Only a rejected request becomes `'error'`,
 * and the typed `PreciosClarosError` is carried out unchanged so the component
 * chooses the copy.
 *
 * Unmount safety follows the repo precedent (`useResolveEans`'s `alive`,
 * `useBarcodeScanner`'s `cancelled`): a late resolve/reject after the component
 * is gone is dropped instead of touching a dead fiber.
 */
const defaultClient = createPreciosClarosClient()

/** Shared reference so an idle re-render bails out instead of re-rendering. */
const IDLE_STATE: SucursalesCercaState = {
  status: 'idle',
  estado: null,
  sucursales: [],
  error: null,
}

export function useSucursalesCerca(options: SucursalesCercaOptions): SucursalesCercaState {
  const { ean, coords, client } = options
  const resolvedClient = client ?? defaultClient
  const [state, setState] = useState<SucursalesCercaState>(IDLE_STATE)

  // Depend on the primitive coordinates, never the `coords` object: a caller
  // that rebuilds the object each render must not trigger a refetch.
  const lat = coords?.lat
  const lng = coords?.lng

  useEffect(() => {
    if (!ean || !coords) {
      setState(IDLE_STATE)
      return
    }

    let alive = true
    setState({ status: 'loading', estado: null, sucursales: [], error: null })

    const run = async (): Promise<void> => {
      try {
        const response = await resolvedClient.fetchProducto({
          idProducto: ean,
          selector: { lat: coords.lat, lng: coords.lng },
        })
        if (!alive) return
        setState({
          status: 'ready',
          estado: deriveEstado(response),
          sucursales: mapSucursales(response),
          error: null,
        })
      } catch (err) {
        if (!alive) return
        setState({
          status: 'error',
          estado: null,
          sucursales: [],
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
    }

    void run()

    return () => {
      alive = false
    }
  }, [ean, lat, lng, resolvedClient])

  return state
}
