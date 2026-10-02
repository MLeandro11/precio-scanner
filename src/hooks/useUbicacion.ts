import { useCallback, useEffect, useRef, useState } from 'react'

export type UbicacionStatus =
  | 'unsupported' // navigator.geolocation is absent
  | 'idle' // nothing requested yet (initial)
  | 'requesting' // a request is in flight
  | 'ready' // coords available
  | 'denied' // the user refused (GeolocationPositionError code 1)
  | 'error' // any other failure (codes 2 and 3, or a throw)

export interface Coordenadas {
  lat: number
  lng: number
}

export interface UbicacionState {
  status: UbicacionStatus
  coords: Coordenadas | null
  /** Asks the browser for one position. No retry, no polling. */
  request: () => void
}

/**
 * On-demand browser geolocation for the "sucursales cerca" CTA.
 *
 * The mount path is the whole design: this hook NEVER asks for a position by
 * itself. There is no effect calling `getCurrentPosition`, so mounting the
 * screen that shows the CTA cannot raise the browser permission prompt — the
 * user has to tap, and the tap is what makes the permission request expected
 * instead of hostile. That also means the initial state is `'idle'` even on a
 * device without geolocation support: `'unsupported'` is a fact about the tap
 * that failed, not about the render, so it is only decided inside `request()`.
 *
 * No retry, no polling, no `watchPosition`: one tap, one
 * `getCurrentPosition`, one answer. A second tap while a request is in flight
 * is swallowed by `inFlightRef` rather than queued, because the browser is
 * already asking and a second call would only stack prompts.
 *
 * Coordinates live in component state and nowhere else. They are deliberately
 * NOT persisted (no localStorage/sessionStorage, not even to "remember" the
 * last position): a location is the one piece of data in this app the user did
 * not type, and nothing in the UI should be able to read a stale one after a
 * reload.
 *
 * `aliveRef` follows the repo's unmount-guard precedent (`useResolveEans`'s
 * `alive`, `useBarcodeScanner`'s `cancelled`): the permission prompt can stay
 * open past an unmount, and the late callback must be dropped instead of
 * touching a dead fiber. The effect re-arms the flag on (re)mount, so React's
 * StrictMode double-invoke does not leave it stuck at `false`.
 */
export function useUbicacion(): UbicacionState {
  const [status, setStatus] = useState<UbicacionStatus>('idle')
  const [coords, setCoords] = useState<Coordenadas | null>(null)
  const inFlightRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /**
   * Stable across renders (`useCallback` with no deps) so a caller can put it
   * in a dependency array without a render loop; the in-flight guard is a ref
   * for the same reason (state would change the callback identity).
   */
  const request = useCallback(() => {
    if (inFlightRef.current) return

    // Read the capability at request time, never cached: the property can be
    // absent from the start (jsdom, or a hardened browser) or disappear
    // between mount and tap.
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geolocation?.getCurrentPosition) {
      setCoords(null)
      setStatus('unsupported')
      return
    }

    inFlightRef.current = true
    // Clear before every attempt, not only on failure: this is what makes
    // "denied"/"error" (and "requesting") never show the coordinates of an
    // earlier success, and it is the only place coords are reset, so no path
    // can leave a stale position behind.
    setCoords(null)
    setStatus('requesting')

    const onSuccess = (position: GeolocationPosition): void => {
      inFlightRef.current = false
      if (!aliveRef.current) return
      setCoords({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      })
      setStatus('ready')
    }

    const onError = (error: GeolocationPositionError): void => {
      inFlightRef.current = false
      if (!aliveRef.current) return
      // Code 1 is the user saying no; codes 2 and 3 are the environment
      // failing. The UI only offers a retry for the second case, so the
      // distinction has to survive this far.
      setStatus(error.code === 1 ? 'denied' : 'error')
    }

    try {
      geolocation.getCurrentPosition(onSuccess, onError)
    } catch {
      // Some engines can throw synchronously (insecure context, disabled
      // API). That is still a plain failure, not a crash on tap.
      inFlightRef.current = false
      if (!aliveRef.current) return
      setStatus('error')
    }
  }, [])

  return { status, coords, request }
}
