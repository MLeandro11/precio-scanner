// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useSucursalesCerca } from './useSucursalesCerca'
import type { SucursalesCercaState } from './useSucursalesCerca'
import { PreciosClarosError } from '../lib/preciosClaros/client'
import type {
  PreciosClarosClient,
  ProductoQuery,
} from '../lib/preciosClaros/client'
import { mapSucursales } from '../lib/preciosClaros/map'
import type { ProductoResponse } from '../lib/preciosClaros/schema'

/**
 * Requirement 9: a late resolve/reject after unmount must not call setState.
 * React 19 is SILENT about an update from a removed component, so an unguarded
 * hook produces exactly the same console/state trace as a guarded one. The only
 * honest probe is to watch the setter itself, so `useState` is wrapped to record
 * its calls while delegating to the real implementation (`useUbicacion.test.ts`
 * uses the same technique). `act`, `createElement` and everything else stay the
 * genuine module.
 */
const { setterCalls, createdClients } = vi.hoisted(() => ({
  setterCalls: [] as unknown[][],
  createdClients: [] as PreciosClarosClient[],
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const useStateShim = ((initial: unknown) => {
    const [value, setValue] = actual.useState(initial)
    const setter = (...args: unknown[]): void => {
      setterCalls.push(args)
      ;(setValue as unknown as (...a: unknown[]) => void)(...args)
    }
    return [value, setter]
  }) as unknown as typeof actual.useState
  return { ...actual, useState: useStateShim }
})

/**
 * Requirement 7: the DEFAULT client must be built once and keep a stable
 * identity. The real factory would reach the network from jsdom, and a
 * per-render factory combined with an effect dependency on the client would
 * refetch forever — both are invisible if the test injects a client. So the
 * factory is wrapped to count every construction and to hand back a client the
 * test can drive. Everything else in the module (the error class, the
 * constants) is the genuine implementation.
 */
vi.mock('../lib/preciosClaros/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/preciosClaros/client')>()
  return {
    ...actual,
    createPreciosClarosClient: (): PreciosClarosClient => {
      const client: PreciosClarosClient = { fetchProducto: vi.fn() }
      createdClients.push(client)
      return client
    },
  }
})

/**
 * `useSucursalesCerca` exists to keep the location permission opt-in: the hook
 * must not spend a request before the user taps. That property is invisible in
 * the returned state (an eager hook still renders `'idle'` first), so the idle
 * and request-discipline probes assert the CALL SPY, never the state. The same
 * reasoning pins "exactly one fetch per (ean, coords) pair": a re-render with
 * the same inputs must leave the spy at one call, which is what catches a
 * missing dependency-array discipline.
 */

type Coords = { lat: number; lng: number }

/** The real reporter, restored after every test below. */
const realError = console.error

const EAN = '7790895000430'
const COORDS: Coords = { lat: -51.6226, lng: -69.2181 }

/** A response with prices: mapped output is ordered by price ascending. */
function conPrecios(): ProductoResponse {
  return {
    status: 200,
    total: 2,
    producto: { id: EAN },
    sucursales: [
      {
        id: '454',
        comercioId: 15,
        banderaId: 1,
        preciosProducto: { precioLista: 5200 },
      },
      {
        id: '261',
        comercioId: 15,
        banderaId: 1,
        preciosProducto: { precioLista: 4900 },
      },
    ],
  }
}

/** Branches exist but none carries a numeric `precioLista`. */
function sinPrecio(): ProductoResponse {
  return {
    status: 200,
    total: 42,
    producto: { id: EAN },
    sucursales: [
      {
        id: '1075',
        comercioId: 11,
        banderaId: 2,
        message: 'La sucursal no contiene el producto.',
      },
      { id: '1076', comercioId: 11, banderaId: 2, preciosProducto: {} },
    ],
  }
}

/** Unknown EAN: `total: 0` (or `producto.msg`) is a normal state, not an error. */
function sinDatos(): ProductoResponse {
  return {
    status: 200,
    total: 0,
    producto: { msg: 'Producto inexistente.' },
    sucursales: [],
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | null = null
  let rejectFn: ((reason: unknown) => void) | null = null
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  return {
    promise,
    resolve: (value) => resolveFn?.(value),
    reject: (reason) => rejectFn?.(reason),
  }
}

function injectedClient(): {
  client: PreciosClarosClient
  fetchProducto: ReturnType<
    typeof vi.fn<(query: ProductoQuery) => Promise<ProductoResponse>>
  >
} {
  const fetchProducto = vi.fn<(query: ProductoQuery) => Promise<ProductoResponse>>()
  const client: PreciosClarosClient = { fetchProducto }
  return { client, fetchProducto }
}

let root: ReturnType<typeof createRoot>
let container: HTMLElement
let mounted = false
let latest: SucursalesCercaState | null = null
let bump: (() => void) | null = null
let errorSpy: ReturnType<typeof vi.fn>
let defaultFetch: ReturnType<typeof vi.mocked<PreciosClarosClient['fetchProducto']>>

interface HarnessProps {
  ean: string | null
  coords: Coords | null
  client?: PreciosClarosClient
}

/**
 * Captures the hook's latest return value. `bump` re-renders the same instance
 * (via a local `useState`) so the fetch-count probes can force renders without
 * remounting.
 */
function Harness(props: HarnessProps) {
  latest = useSucursalesCerca(props)
  const [, setTick] = useState(0)
  bump = () => setTick((n) => n + 1)
  return null
}

function current(): SucursalesCercaState {
  if (!latest) throw new Error('harness is not mounted')
  return latest
}

/** Drains the microtask queue the hook's setState calls settle on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render(props: HarnessProps): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(createElement(Harness, props))
  })
  await flush()
}

async function unmount(): Promise<void> {
  if (!mounted) return
  mounted = false
  await act(async () => {
    root.unmount()
  })
}

beforeEach(() => {
  latest = null
  bump = null
  mounted = false
  setterCalls.length = 0
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  errorSpy = vi.fn()
  console.error = errorSpy as unknown as typeof console.error

  // The module-level default client is the first one ever constructed.
  defaultFetch = vi.mocked(createdClients[0].fetchProducto)
  defaultFetch.mockReset()
  // Pending by default: a test that wants a settle drives it explicitly, and a
  // forgotten settle can never fire a real network request.
  defaultFetch.mockReturnValue(new Promise<ProductoResponse>(() => {}))

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await unmount()
  console.error = realError
  vi.restoreAllMocks()
  container.remove()
})

describe('useSucursalesCerca idle gate', () => {
  it('stays idle and never fetches with ean === null', async () => {
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockReturnValue(new Promise<ProductoResponse>(() => {}))

    await render({ ean: null, coords: COORDS, client })

    expect(current().status).toBe('idle')
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
    expect(current().error).toBeNull()
    expect(fetchProducto).not.toHaveBeenCalled()
  })

  it('stays idle and never fetches with coords === null', async () => {
    const { client, fetchProducto } = injectedClient()

    await render({ ean: EAN, coords: null, client })

    expect(current().status).toBe('idle')
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
    expect(current().error).toBeNull()
    expect(fetchProducto).not.toHaveBeenCalled()
  })

  it('treats an empty ean as absent and never fetches', async () => {
    const { client, fetchProducto } = injectedClient()

    await render({ ean: '', coords: COORDS, client })

    expect(current().status).toBe('idle')
    expect(fetchProducto).not.toHaveBeenCalled()
  })

  it('never fetches on the first mount even with both inputs present until the effect runs once', async () => {
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockReturnValue(new Promise<ProductoResponse>(() => {}))

    await render({ ean: EAN, coords: COORDS, client })

    // The effect is the only place the request starts; exactly one.
    expect(fetchProducto).toHaveBeenCalledTimes(1)
  })
})

describe('useSucursalesCerca request lifecycle', () => {
  it('turns loading and calls fetchProducto exactly once with the ean and coordinates', async () => {
    const { client, fetchProducto } = injectedClient()
    const pending = deferred<ProductoResponse>()
    fetchProducto.mockReturnValue(pending.promise)

    await render({ ean: EAN, coords: COORDS, client })

    expect(current().status).toBe('loading')
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
    expect(current().error).toBeNull()
    expect(fetchProducto).toHaveBeenCalledTimes(1)
    expect(fetchProducto).toHaveBeenCalledWith({
      idProducto: EAN,
      selector: { lat: COORDS.lat, lng: COORDS.lng },
    })
  })

  it('resolves to ready with the mapped branches (same order) and the derived estado', async () => {
    const { client, fetchProducto } = injectedClient()
    const response = conPrecios()
    fetchProducto.mockResolvedValue(response)

    await render({ ean: EAN, coords: COORDS, client })

    expect(current().status).toBe('ready')
    expect(current().sucursales).toEqual(mapSucursales(response))
    // Order is the map output, ascending by price, never re-sorted by the hook.
    expect(current().sucursales.map((s) => s.clave)).toEqual(['15-1-261', '15-1-454'])
    expect(current().estado).toBe('con-precios')
    expect(current().error).toBeNull()
  })

  it('reaches all three estados distinctly', async () => {
    const cases: Array<{ response: ProductoResponse; estado: string }> = [
      { response: conPrecios(), estado: 'con-precios' },
      { response: sinPrecio(), estado: 'sin-precio' },
      { response: sinDatos(), estado: 'sin-datos' },
    ]

    for (let i = 0; i < cases.length; i += 1) {
      const { response, estado } = cases[i]
      const { client, fetchProducto } = injectedClient()
      fetchProducto.mockResolvedValue(response)

      // A distinct ean forces the effect to run again on the same root.
      await render({ ean: `${EAN}-${i}`, coords: COORDS, client })

      expect(current().status).toBe('ready')
      expect(current().estado).toBe(estado)
    }
  })
})

describe('useSucursalesCerca failures', () => {
  it('maps a rejected PreciosClarosError to error without throwing', async () => {
    const { client, fetchProducto } = injectedClient()
    const failure = new PreciosClarosError('timeout', 'se agotó el tiempo')
    fetchProducto.mockRejectedValue(failure)

    await expect(render({ ean: EAN, coords: COORDS, client })).resolves.toBeUndefined()

    expect(current().status).toBe('error')
    expect(current().error).toBe(failure)
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
  })

  it('maps a rejected generic Error to error without throwing', async () => {
    const { client, fetchProducto } = injectedClient()
    const failure = new Error('boom')
    fetchProducto.mockRejectedValue(failure)

    await expect(render({ ean: EAN, coords: COORDS, client })).resolves.toBeUndefined()

    expect(current().status).toBe('error')
    expect(current().error).toBe(failure)
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
  })
})

describe('useSucursalesCerca request discipline', () => {
  it('does not refetch when the component re-renders with unchanged ean/coords', async () => {
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(conPrecios())

    await render({ ean: EAN, coords: COORDS, client })
    expect(current().status).toBe('ready')

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        bump?.()
      })
    }

    expect(fetchProducto).toHaveBeenCalledTimes(1)
  })

  it('does not refetch when only the coords object identity changes', async () => {
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(conPrecios())

    await render({ ean: EAN, coords: COORDS, client })
    expect(current().status).toBe('ready')

    // A caller that rebuilds the object each render (same values) must not
    // refetch: the effect depends on the primitive lat/lng, not the object.
    await render({ ean: EAN, coords: { ...COORDS }, client })

    expect(fetchProducto).toHaveBeenCalledTimes(1)
  })

  it('never schedules a poll or a retry', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(conPrecios())

    await render({ ean: EAN, coords: COORDS, client })

    expect(current().status).toBe('ready')
    expect(fetchProducto).toHaveBeenCalledTimes(1)
    expect(setInterval).not.toHaveBeenCalled()
  })

  it('builds the default client once and keeps it stable across forced re-renders', async () => {
    expect(createdClients).toHaveLength(1)

    await render({ ean: EAN, coords: COORDS })

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        bump?.()
      })
    }

    // A fresh client per render would grow this list AND refetch every render.
    expect(createdClients).toHaveLength(1)
    expect(defaultFetch).toHaveBeenCalledTimes(1)
  })

  it('clears stale results while a new attempt is loading', async () => {
    const { client, fetchProducto } = injectedClient()
    const first = deferred<ProductoResponse>()
    const second = deferred<ProductoResponse>()
    fetchProducto.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    await render({ ean: EAN, coords: COORDS, client })
    first.resolve(conPrecios())
    await flush()
    expect(current().status).toBe('ready')
    expect(current().sucursales.length).toBeGreaterThan(0)

    await render({ ean: EAN, coords: { lat: -34.6, lng: -58.4 }, client })

    expect(current().status).toBe('loading')
    expect(current().sucursales).toEqual([])
    expect(current().estado).toBeNull()
    expect(fetchProducto).toHaveBeenCalledTimes(2)
  })
})

describe('useSucursalesCerca unmount safety', () => {
  it('drops a late resolve after unmount without touching state or throwing', async () => {
    const { client, fetchProducto } = injectedClient()
    const pending = deferred<ProductoResponse>()
    fetchProducto.mockReturnValue(pending.promise)

    await render({ ean: EAN, coords: COORDS, client })
    expect(current().status).toBe('loading')

    await unmount()

    setterCalls.length = 0
    expect(() => pending.resolve(conPrecios())).not.toThrow()

    await flush()
    expect(setterCalls).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('drops a late reject after unmount without touching state or throwing', async () => {
    const { client, fetchProducto } = injectedClient()
    const pending = deferred<ProductoResponse>()
    fetchProducto.mockReturnValue(pending.promise)

    await render({ ean: EAN, coords: COORDS, client })
    expect(current().status).toBe('loading')

    await unmount()

    setterCalls.length = 0
    expect(() => pending.reject(new Error('late'))).not.toThrow()

    await flush()
    expect(setterCalls).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
