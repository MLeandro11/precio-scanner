// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useUbicacion } from './useUbicacion'
import type { UbicacionState } from './useUbicacion'

/**
 * Requirement: a late geolocation answer after unmount must not call setState.
 * That cannot be observed through React's output: React 19 is SILENT about an
 * update from a removed component (the old "state update on an unmounted
 * component" warning is gone), so an unguarded hook with no `alive` check
 * produces exactly the same console/state trace as a guarded one. The only
 * honest probe is to watch the setter itself, so `useState` is wrapped to
 * record its calls while delegating to the real implementation. `act`,
 * `createElement` and everything else stay the genuine module.
 */
const { setterCalls } = vi.hoisted(() => ({ setterCalls: [] as unknown[][] }))

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
 * `useUbicacion` exists to make the position permission OPT-IN: the whole point
 * of the hook is that mounting it asks the user for NOTHING and only a tap
 * reaches the browser. That property is invisible in the returned value — a
 * hook that calls `getCurrentPosition` on mount still returns `{ status: 'idle',
 * coords: null }` on its first render — so the mount test asserts the CALL SPY,
 * never the state.
 *
 * The same reasoning drives the "no retry / no polling / no storage" rules: each
 * is pinned by an absence assertion (`toHaveBeenCalledTimes(1)`,
 * `not.toHaveBeenCalled()`), because the state after a success looks identical
 * whether the hook asked once or eight times.
 *
 * Three branches get their own probes because they are the ones a naive
 * implementation gets wrong:
 *  - `unsupported` is decided at REQUEST time, never cached at module scope or
 *    from the first render: jsdom does not implement `navigator.geolocation` at
 *    all, and the property can also disappear between mount and tap, so both
 *    orders are exercised.
 *  - a denial (code 1) must not collapse into the generic `error` state, and a
 *    later failure must not leave the coordinates of an earlier success behind.
 *  - the unmount path: the browser can answer after the component is gone, and
 *    the late callback must be dropped instead of touching a removed instance.
 *    React 19 says nothing about an update from a removed component, so that
 *    one is asserted against the recorded setter calls (see the `useState`
 *    wrapper at the top of this file), not against a console warning.
 *
 * The repo has no vitest config, so the DOM environment is opted in per file
 * with the docblock on line 1 (`useBarcodeScanner.test.ts` does the same).
 */

type SuccessCallback = (position: GeolocationPosition) => void
type ErrorCallback = (error: GeolocationPositionError) => void

/** The real reporter, restored after every test below. */
const realError = console.error

let root: ReturnType<typeof createRoot>
let container: HTMLElement
let mounted = false
let state: UbicacionState | null = null
let bump: (() => void) | null = null
let errorSpy: ReturnType<typeof vi.fn>
let getCurrentPosition: ReturnType<typeof vi.fn>
let watchPosition: ReturnType<typeof vi.fn>

/**
 * Captures the hook's latest return value. `bump` re-renders the same instance
 * (via a local `useState`) so `request` identity can be compared across renders
 * without remounting, which would hand back a brand new hook instance.
 */
function Harness() {
  const ubicacion = useUbicacion()
  state = ubicacion
  const [, setTick] = useState(0)
  bump = () => setTick((n) => n + 1)
  return null
}

function current(): UbicacionState {
  if (!state) throw new Error('harness is not mounted')
  return state
}

/** Position shaped like the one the browser hands to the success callback. */
function fakePosition(lat: number, lng: number): GeolocationPosition {
  return { coords: { latitude: lat, longitude: lng } } as unknown as GeolocationPosition
}

/** The only field the hook may read off a failure: the numeric code. */
function fakeError(code: number): GeolocationPositionError {
  return { code } as unknown as GeolocationPositionError
}

/** jsdom has no `geolocation`, so "absent" is the default and "present" is installed. */
function installGeolocation(): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition },
  })
}

function removeGeolocation(): void {
  delete (navigator as { geolocation?: unknown }).geolocation
}

/** Drains the microtask queue the hook's setState calls settle on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function mount(): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(createElement(Harness))
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

/** A tap: `request()` is synchronous, so one `act` flush covers it. */
async function tap(): Promise<void> {
  await act(async () => {
    current().request()
  })
}

beforeEach(() => {
  state = null
  bump = null
  mounted = false
  setterCalls.length = 0
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  // Secondary signal only: React routes "update not wrapped in act" through
  // console.error. The unmount test's real guarantee is the setter log, since
  // React is silent about a removed component.
  errorSpy = vi.fn()
  console.error = errorSpy as unknown as typeof console.error

  getCurrentPosition = vi.fn()
  watchPosition = vi.fn()

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await unmount()
  removeGeolocation()
  console.error = realError
  vi.restoreAllMocks()
  container.remove()
})

describe('useUbicacion initial state', () => {
  it('starts idle with no coords and never asks the browser on mount', async () => {
    installGeolocation()

    await mount()

    expect(current().status).toBe('idle')
    expect(current().coords).toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(watchPosition).not.toHaveBeenCalled()
  })

  it('stays idle without geolocation too: missing support is only decided on request', async () => {
    removeGeolocation()

    await mount()

    expect(current().status).toBe('idle')
    expect(current().coords).toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})

describe('useUbicacion request lifecycle', () => {
  it("enters 'requesting' until the browser answers, then becomes ready with the coords", async () => {
    let pending: SuccessCallback | null = null
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      pending = success
    })
    installGeolocation()
    await mount()

    await tap()

    expect(current().status).toBe('requesting')
    expect(current().coords).toBeNull()
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending?.(fakePosition(-51.6226, -69.2181))
    })

    expect(current().status).toBe('ready')
    expect(current().coords).toEqual({ lat: -51.6226, lng: -69.2181 })
  })

  it('maps a denial (code 1) to denied and any other code to error', async () => {
    installGeolocation()
    await mount()

    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error(fakeError(1))
    })
    await tap()
    expect(current().status).toBe('denied')
    expect(current().coords).toBeNull()

    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error(fakeError(2))
    })
    await tap()
    expect(current().status).toBe('error')
    expect(current().coords).toBeNull()

    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error(fakeError(3))
    })
    await tap()
    expect(current().status).toBe('error')
    expect(current().coords).toBeNull()
  })

  it('survives a synchronous throw from getCurrentPosition as a plain error', async () => {
    installGeolocation()
    await mount()

    getCurrentPosition.mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(tap()).resolves.toBeUndefined()

    expect(current().status).toBe('error')
    expect(current().coords).toBeNull()
  })

  it('reports unsupported (without throwing) when the property is absent at the tap', async () => {
    removeGeolocation()
    await mount()

    await expect(tap()).resolves.toBeUndefined()

    expect(current().status).toBe('unsupported')
    expect(current().coords).toBeNull()
  })

  it('reports unsupported when the property disappears between mount and tap', async () => {
    installGeolocation()
    await mount()
    expect(current().status).toBe('idle')

    // No "supported" verdict may have been cached at module scope or on the
    // first render: the capability is read at request time.
    removeGeolocation()

    await expect(tap()).resolves.toBeUndefined()

    expect(current().status).toBe('unsupported')
    expect(current().coords).toBeNull()
  })

  it('never leaves stale coords behind when a later request fails', async () => {
    installGeolocation()
    await mount()

    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      success(fakePosition(-51.6226, -69.2181))
    })
    await tap()
    expect(current().status).toBe('ready')
    expect(current().coords).toEqual({ lat: -51.6226, lng: -69.2181 })

    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error(fakeError(1))
    })
    await tap()
    expect(current().status).toBe('denied')
    expect(current().coords).toBeNull()

    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      success(fakePosition(-51.6226, -69.2181))
    })
    await tap()
    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error(fakeError(3))
    })
    await tap()
    expect(current().status).toBe('error')
    expect(current().coords).toBeNull()
  })
})

describe('useUbicacion request discipline', () => {
  it('calls getCurrentPosition exactly once per request and never polls', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      success(fakePosition(-51.6226, -69.2181))
    })
    installGeolocation()
    await mount()

    await tap()
    await flush()

    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(watchPosition).not.toHaveBeenCalled()
    expect(setInterval).not.toHaveBeenCalled()
  })

  it('ignores a second request while one is still in flight', async () => {
    let pending: SuccessCallback | null = null
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      pending = success
    })
    installGeolocation()
    await mount()

    await tap()
    await tap()

    expect(current().status).toBe('requesting')
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)

    // Once the in-flight request settles, a new tap is allowed again.
    await act(async () => {
      pending?.(fakePosition(-51.6226, -69.2181))
    })
    expect(current().status).toBe('ready')

    await tap()
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('keeps request referentially stable across renders', async () => {
    installGeolocation()
    await mount()

    const first = current().request

    await act(async () => {
      bump?.()
    })

    expect(current().request).toBe(first)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it('never touches localStorage or sessionStorage on a successful request', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      success(fakePosition(-51.6226, -69.2181))
    })
    installGeolocation()
    await mount()

    await tap()
    expect(current().status).toBe('ready')

    expect(setItem).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
  })
})

describe('useUbicacion unmount safety', () => {
  it('drops a late answer after unmount without touching state or throwing', async () => {
    let pending: SuccessCallback | null = null
    let pendingError: ErrorCallback | null = null
    getCurrentPosition.mockImplementation((success: SuccessCallback, error: ErrorCallback) => {
      pending = success
      pendingError = error
    })
    installGeolocation()
    await mount()

    await tap()
    expect(current().status).toBe('requesting')

    await unmount()

    // The browser answers after the component is gone. The wrapper records every
    // setState the hook reaches for, so a missing `alive` guard fails HERE even
    // though React itself stays quiet.
    setterCalls.length = 0
    expect(() => pending?.(fakePosition(-51.6226, -69.2181))).not.toThrow()
    expect(() => pendingError?.(fakeError(1))).not.toThrow()

    await flush()
    expect(setterCalls).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
