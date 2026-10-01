// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useBarcodeScanner } from './useBarcodeScanner'
import type { BarcodeScanner } from './useBarcodeScanner'

/**
 * The wrapper lifecycle in `useBarcodeScanner` has TWO teardown paths — the
 * effect cleanup (unmount / `retry`) and the `start()` catch (denied camera,
 * decode failure after install) — and before this file nothing asserted either.
 * Drop one of those calls and the global `console.warn` filter outlives the
 * decode loop, so the app silently discards EVERY warning with no red check
 * (`SCAN-zxing-noise` only asserts nothing matched while the loop was alive).
 *
 * Every probe uses the exact upstream warning shape the filter targets and
 * decides by identity (`console.warn === spy`, i.e. restored) AND by behaviour
 * (does the probe reach the original spy). `src/lib/zxingWarning.test.ts`
 * already covers the module; this file covers the hook that owns its lifecycle.
 *
 * This is the only test file that declares `@vitest-environment jsdom`; the rest
 * keep running under Node.
 */
const MISS_PREFIX = 'MultiFormatReader: non-ReaderException from reader:'

const { decodeFromStreamMock } = vi.hoisted(() => ({ decodeFromStreamMock: vi.fn() }))

// Keep the real `BarcodeFormat` enum (the hook builds its decode hints from it)
// and replace only the reader whose `decodeFromStream` is the live decode loop.
vi.mock('@zxing/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zxing/browser')>()
  class MockBrowserMultiFormatReader {
    decodeFromStream = (...args: unknown[]): unknown => decodeFromStreamMock(...args)
  }
  return {
    ...actual,
    BrowserMultiFormatReader:
      MockBrowserMultiFormatReader as unknown as typeof actual.BrowserMultiFormatReader,
  }
})

const realWarn = console.warn

let root: ReturnType<typeof createRoot>
let container: HTMLElement
let mounted = false
let scannerRef: BarcodeScanner | null = null
let warnSpy: ReturnType<typeof vi.fn>
let getUserMedia: ReturnType<typeof vi.fn>

const noopDetect = (): void => {}

function Harness() {
  const scanner = useBarcodeScanner(noopDetect)
  scannerRef = scanner
  return createElement('video', { ref: scanner.videoRef })
}

function current(): BarcodeScanner {
  if (!scannerRef) throw new Error('harness is not mounted')
  return scannerRef
}

/** A plain Error shaped exactly like the reader outcome the filter must drop. */
function upstreamMiss(): Error {
  const err = new Error('not found')
  err.name = 'NotFoundException'
  return err
}

function fakeStream(): MediaStream {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}) as MediaTrackCapabilities,
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  } as unknown as MediaStreamTrack
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
}

/**
 * Drain the hook's `start()` microtask chain without timers or sleeps. `start`
 * awaits getUserMedia, `video.play()` and `decodeFromStream`, and every mock
 * settles on the microtask queue, so a bounded number of `act` flushes is
 * deterministic. Each `act` drains the queue, which also lets a newly queued
 * continuation run before the next iteration.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function mountHarness(): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(createElement(Harness))
  })
  await settle()
}

async function unmountHarness(): Promise<void> {
  if (!mounted) return
  mounted = false
  await act(async () => {
    root.unmount()
  })
}

beforeEach(() => {
  scannerRef = null
  mounted = false
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  // Install a bare `vi.fn()` as console.warn BEFORE mounting, so it is the
  // "original" the hook's wrapper wraps. Identity is asserted against this exact
  // fn, behaviour against its call log.
  warnSpy = vi.fn()
  console.warn = warnSpy as unknown as typeof console.warn

  getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  // jsdom does not implement play() and has no srcObject accessor.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    writable: true,
    value: null,
  })

  decodeFromStreamMock.mockReset()

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await unmountHarness()
  console.warn = realWarn
  delete (HTMLMediaElement.prototype as { srcObject?: unknown }).srcObject
  delete (navigator as { mediaDevices?: unknown }).mediaDevices
  vi.restoreAllMocks()
  container.remove()
})

describe('useBarcodeScanner wrapper lifecycle', () => {
  it('keeps the filter active while scanning: the upstream miss is swallowed, other warnings forwarded', async () => {
    getUserMedia.mockResolvedValue(fakeStream())
    decodeFromStreamMock.mockResolvedValue({ stop: vi.fn() })

    await mountHarness()
    expect(current().status).toBe('active')

    warnSpy.mockClear()
    console.warn(MISS_PREFIX, upstreamMiss())
    expect(warnSpy).not.toHaveBeenCalled()

    console.warn('unrelated warning')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('unrelated warning')
  })

  it('restores console.warn on unmount', async () => {
    getUserMedia.mockResolvedValue(fakeStream())
    decodeFromStreamMock.mockResolvedValue({ stop: vi.fn() })

    await mountHarness()
    expect(current().status).toBe('active')

    // Prove the wrapper really is installed before the teardown under test.
    warnSpy.mockClear()
    console.warn(MISS_PREFIX, upstreamMiss())
    expect(warnSpy).not.toHaveBeenCalled()

    await unmountHarness()

    warnSpy.mockClear()
    const miss = upstreamMiss()
    console.warn(MISS_PREFIX, miss)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(MISS_PREFIX, miss)
    expect(console.warn).toBe(warnSpy)
  })

  it('restores console.warn when the camera permission is denied', async () => {
    const denied = new Error('denied')
    denied.name = 'NotAllowedError'
    getUserMedia.mockRejectedValue(denied)

    await mountHarness()
    expect(current().status).toBe('denied')

    warnSpy.mockClear()
    const miss = upstreamMiss()
    console.warn(MISS_PREFIX, miss)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(MISS_PREFIX, miss)
    expect(console.warn).toBe(warnSpy)
  })

  it('restores console.warn when the decode loop fails after the filter was installed', async () => {
    getUserMedia.mockResolvedValue(fakeStream())
    let rejectDecode!: (err: unknown) => void
    decodeFromStreamMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecode = reject
        }),
    )

    await mountHarness()
    expect(current().status).toBe('requesting')

    // The wrapper is live while the decode promise is pending.
    warnSpy.mockClear()
    console.warn(MISS_PREFIX, upstreamMiss())
    expect(warnSpy).not.toHaveBeenCalled()

    const notReadable = new Error('busy')
    notReadable.name = 'NotReadableError'
    await act(async () => {
      rejectDecode(notReadable)
      await Promise.resolve()
    })
    await settle()
    expect(current().status).toBe('error')

    // The start() catch must have restored it, not left it installed.
    warnSpy.mockClear()
    const miss = upstreamMiss()
    console.warn(MISS_PREFIX, miss)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(MISS_PREFIX, miss)
    expect(console.warn).toBe(warnSpy)
  })

  it('retry() does not stack wrappers: unmount returns exactly the original', async () => {
    const denied = new Error('denied')
    denied.name = 'NotAllowedError'
    getUserMedia.mockRejectedValueOnce(denied).mockResolvedValueOnce(fakeStream())
    decodeFromStreamMock.mockResolvedValue({ stop: vi.fn() })

    await mountHarness()
    expect(current().status).toBe('denied')

    await act(async () => {
      current().retry()
    })
    await settle()
    expect(current().status).toBe('active')

    // The retried attempt installed exactly one wrapper.
    warnSpy.mockClear()
    console.warn(MISS_PREFIX, upstreamMiss())
    expect(warnSpy).not.toHaveBeenCalled()

    await unmountHarness()

    warnSpy.mockClear()
    const miss = upstreamMiss()
    console.warn(MISS_PREFIX, miss)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(MISS_PREFIX, miss)
    expect(console.warn).toBe(warnSpy)
  })
})
